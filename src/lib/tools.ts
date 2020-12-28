/**
 * `tools.ts`
 * - main helpers for clusters
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 *
 * Copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from 'lemon-core';
import { DDSEvent, WSSEvent, GETERR, lib } from 'lemon-core';
import AWS from 'aws-sdk';
import { ClusterEvent } from './clusters';
const NS = $U.NS('tools', 'magenta'); // NAMESPACE TO BE PRINTED.

/**
 * base64 encoding/decoding for parsing `connection-id`
 */
export const $base64 = {
    encode: (unencoded: string, enc: any = 'utf8') => Buffer.from(unencoded || '', enc).toString('base64'),
    decode: (encoded: string, out: any = 'utf8') => Buffer.from(encoded || '', 'base64').toString(out),
    urlEncode: (unencoded: string) =>
        $base64
            .encode(unencoded, 'hex')
            .replace(/\+/g, '-')
            .replace(/\//g, '_'),
    urlDecode: (encoded: string) => {
        encoded = encoded.replace('-', '+').replace('_', '/');
        while (encoded.length % 4) encoded += '=';
        return $base64.decode(encoded, 'hex');
    },
};

/**
 * parse the encoded string to base64.
 * @param body string
 */
export const parseBase64 = (body: string): string => $base64.urlDecode(`${body || ''}`);

/**
 * translate the origin event to cluster-event.
 */
export const convertWSSEvent = (event?: WSSEvent): ClusterEvent => {
    const $hdr = event && event.headers;
    let authorization = `${($hdr && $hdr.Authorization) || ''}`;
    const origin = `${($hdr && $hdr['Origin']) || ''}`;
    const param = { ...(event && event.queryStringParameters) };

    const $req: any = event && event.requestContext;
    const $idt: any = $req && $req.identity;
    const id = `${($req && $req.requestId) || ''}`;
    const type = `${($req && $req.eventType) || ''}` as ClusterEvent['type'];
    const route = `${($req && $req.routeKey) || ''}` as ClusterEvent['route'];
    const stage = `${($req && $req.stage) || ''}` as ClusterEvent['stage'];
    const remote = `${($hdr && $hdr['X-Forwarded-For']) || ($idt && $idt['sourceIp']) || ''}`;
    const agent = `${($hdr && $hdr['User-Agent']) || ($idt && $idt['userAgent']) || ''}`;
    const direction = `${($req && $req.messageDirection) || ''}` as ClusterEvent['direction'];
    const reason = `${($req && $req.disconnectReason) || ''}`;
    const domain = `${($req && $req.domainName) || ''}`;
    const connectionId = `${($req && $req.connectionId) || ''}`;
    const messageId = `${($req && $req.messageId) || ''}`;
    const apiId = `${($req && $req.apiId) || ''}`;
    const connectedAt = ($req && $req.connectedAt) || 0;
    const body = event && event.body;

    // extract `auth` from query.
    const $qs = event && event.queryStringParameters;
    if ($qs && $qs['auth']) authorization = authorization || `Basic ${$qs.auth}`.trim();

    //! returns;
    return {
        id,
        type,
        route,
        authorization,
        origin,
        param,
        stage,
        remote,
        agent,
        direction,
        reason,
        domain,
        connectionId,
        messageId,
        apiId,
        connectedAt,
        body,
    };
};

/**
 * transform the dynamo stream record.
 *
 * @param record
 */
export const transformStreamRecord = (record: any) => {
    if (!record || !record.dynamodb) return null;
    // const region = record.awsRegion;
    // const eid = record.eventID;
    const event = record.eventName;
    const table = (record.eventSourceARN && record.eventSourceARN.split('/')[1]) || '';

    const dynamodb = record.dynamodb;
    const $key = dynamodb.Keys ? lib.toJavascript(dynamodb.Keys, null) : null;
    const $new = dynamodb.NewImage ? lib.toJavascript(dynamodb.NewImage, null) : null; // null if eventName == 'REMOVE'
    const $old = dynamodb.OldImage ? lib.toJavascript(dynamodb.OldImage, null) : null; // null if eventName == 'INSERT'

    //! calculate the latest node, and previous one.
    const last = $new || $old || {}; // make sure not null.
    const diff = event === 'MODIFY' ? $U.diff($old, $new) : Object.keys(last);
    const prev = diff.reduce((M: any, key: any) => {
        if ($old) M[key] = $old[key];
        return M;
    }, {});

    //! returns..
    return { table, keys: $key, last, prev, diff };
};

/**
 * translate the origin DynamoStreamEvent
 */
export const convertDDSEvent = (event: DDSEvent) => {
    const { Records } = event;
    if (!Records || !Array.isArray(Records)) throw new Error(`.Records[] is required!`);
    const nodes = (Records as any[]).map(R => transformStreamRecord(R));
    return { nodes };
};

/**
 * create AGMA (ApiGatewayManagementApi)
 *
 * @param endpoint enpoint-url like `https://${domain}/${stage}`
 */
export const buildAGW = (endpoint: string, silent?: boolean) => {
    //! default config. (no required to have `region`)
    const CONF = 0 ? {} : { region: 'ap-northeast-2', apiVersin: '2015-10-07' };
    const config = { ...CONF, apiVersion: '2029', endpoint };
    silent || _log(NS, '> config =', $U.json(config));
    const ERR_CASE01 = {
        code: 'GoneException',
        message: '410',
        statusCode: 410,
        time: '2020-12-04T11:19:13.910Z',
        requestId: '2a606b4d-be9e-49fa-a9a0-043f44297fa2',
        retryable: false,
        retryDelay: 19.448014263978507,
    };
    const onError = (e: any) => {
        const M =
            e && e instanceof Error
                ? Object.keys(e).reduce((M: any, key) => {
                      if (e.hasOwnProperty(key)) M[key] = (e as any)[key];
                      return M;
                  }, {})
                : { message: GETERR(e) };
        M.code || _err(NS, '>> err =', e); // print error print if no .code.
        silent || _err(NS, `>> $err =`, $U.json(M));
        return Promise.reject(M as typeof ERR_CASE01);
    };
    //! make instance..
    const $agw = new AWS.ApiGatewayManagementApi(config);
    const postToConnection = (params: { ConnectionId: string; Data: string }): Promise<void> =>
        $agw
            .postToConnection(params)
            .promise()
            .then(data => {
                silent || _log(NS, `>> res[postToConnection] =`, typeof data, $U.json(data));
                // _log(NS, '>> $res =', data.$response); //! response handler...
                return;
            })
            .catch(onError);

    const deleteConnection = (params: { ConnectionId: string }) =>
        $agw
            .deleteConnection(params)
            .promise()
            .then(data => {
                silent || _log(NS, `>> res[deleteConnection] =`, typeof data, $U.json(data));
                // _log(NS, '>> $res =', data.$response); //! response handler...
                return;
            })
            .catch(onError);

    // returns {}
    return {
        config,
        onError,
        postToConnection,
        deleteConnection,
    };
};
