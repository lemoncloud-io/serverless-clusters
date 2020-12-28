/**
 * `lambda-wss-handler.ts`
 * - lambda handler to process WSS event.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import $core, { _log, _inf, _err, $U, NUL404 } from 'lemon-core';
import {
    GeneralWEBController,
    LambdaHandlerService,
    WSSHandler,
    NextHandler,
    DynamoStreamHandler,
    doReportError,
    GETERR$,
    GETERR,
} from 'lemon-core';
import { APIGatewayProxyResult } from 'aws-lambda';
import { $clusters } from '../lib/clusters';
import $service, { ClusterService } from '../service/cluster-service';
import { ProtocolType } from '../lib/protocol';
import { NodeModel } from '../service/cluster-model';
const NS = $U.NS('clusters', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * send http response..
 * @param statusCode status-code like 200
 * @param body       body
 */
export const buildResponse = (statusCode: number, body: any): APIGatewayProxyResult => {
    // @0612 - body 가 string일 경우, 응답형식을 텍스트로 바꿔서 출력한다.
    return {
        statusCode,
        headers: {
            'Content-Type':
                typeof body === 'string'
                    ? body.startsWith('<') && body.endsWith('>')
                        ? 'text/html; charset=utf-8'
                        : 'text/plain; charset=utf-8'
                    : 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*', // Required for CORS support to work
            'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    };
};

export const success = (body: any) => {
    return buildResponse(200, body);
};

export const notfound = (body: any) => {
    return buildResponse(404, body);
};

export const invalid = (body: any) => {
    return buildResponse(403, body);
};

export const failure = (body: any, status: number = 503) => {
    return buildResponse(status, body);
};

/**
 * class: `ClustersAPIController`.
 * - support both Nest Controller & WebController
 */
export class ClustersAPIController extends GeneralWEBController {
    protected service: ClusterService;
    /**
     * default constructor()
     */
    public constructor(service?: ClusterService, register?: boolean) {
        super('clusters');
        this.service = service || $service;
        _log(NS, `ClustersAPIController()...`);
        //! register into lambda-handler.
        register && $core.cores.lambda.lambda.setHandler('wss', this.$wss); //! web-socket
        register && $core.cores.lambda.lambda.setHandler('dds', this.$dds); //! dynamo-stream.
    }

    /**
     * name of this resource.
     */
    public hello = () => `clusters-api-controller:${this.type()}`;

    // implements LambdaHandlerService<WSSHandler>
    public readonly $wss = new (class implements LambdaHandlerService<WSSHandler> {
        protected thiz: ClustersAPIController;
        public constructor(thiz: ClustersAPIController) {
            this.thiz = thiz;
        }
        public handle: WSSHandler = async (event, context) => {
            const NS = $U.NS('.wss', 'blue');
            _log(NS, `handle()...`);
            const $req = event && event.requestContext;
            const EVENT_TYPE = ($req && $req.eventType) || '';
            const ROUTE_KEY = ($req && $req.routeKey) || '';
            _log(NS, '> context =', $U.json(context));
            _log(NS, `> event(${ROUTE_KEY}/${EVENT_TYPE}) =`, $U.json(event));
            //TODO - response's body is not required!!!!!!!
            return $clusters(this.thiz.service, event, context)
                .run()
                .then(r => success(r || ''))
                .catch(e => {
                    const err = GETERR(e);
                    if (err.startsWith('404 ')) return notfound(err);
                    // if (err.startsWith('@') || err.startsWith('.')) return invalid(err);
                    //! or report error..
                    return doReportError(e, context, event)
                        .catch(GETERR$)
                        .then(() => (err.startsWith('@') || err.startsWith('.') ? invalid(err) : failure(err)));
                });
        };
    })(this);

    /**
     * class implements LambdaHandlerService<DynamoStreamHandler>
     */
    public readonly $dds = new (class implements LambdaHandlerService<DynamoStreamHandler> {
        protected thiz: ClustersAPIController;
        public constructor(thiz: ClustersAPIController) {
            this.thiz = thiz;
        }
        public handle: DynamoStreamHandler = async (event, context) => {
            const NS = $U.NS('.dds', 'blue');
            _log(NS, `handle()...`);
            _log(NS, '> event =', $U.json(event));
            _log(NS, '> context =', $U.json(context));
            const success = (): any => undefined;
            return $clusters(this.thiz.service, null, context)
                .dynamo(event)
                .then(success)
                .catch(e =>
                    doReportError(e, context, event)
                        .catch(GETERR$)
                        .then(success),
                );
        };
    })(this);

    /**
     * force to disconnect the target node.
     *
     * ```sh
     * $ http ':8121/clusters/d32dba77-9d7b-4ad2-8676-c1ac3ebd425b/disconnect'
     * $ http ':8121/clusters/1000420/disconnect'
     * ```
     * @param id    target-id of edge/node.
     */
    public getClustersDisconnect: NextHandler = async (id, param, body, ctx) => {
        _log(NS, `getClustersDisconnect(${id})...`);
        id = `${id === '0' ? '' : id || ''}`.trim();
        const data = await $clusters(this.service, null, ctx).disconnect(id);
        return { id, data };
    };

    /**
     * get the node infor.
     *
     * ```sh
     * $ http ':8121/clusters/1000420/node-info'
     * ```
     * @param id    target-id of edge/node.
     */
    public getClustersNodeInfo: NextHandler = async (id, param, body, ctx) => {
        _log(NS, `getClustersNodeInfo(${id})...`);
        id = `${id === '0' ? '' : id || ''}`.trim();
        const data = await $clusters(this.service, null, ctx)
            .findNode(id)
            .then(async $I => {
                const { nodeId } = $I;
                const $node: NodeModel = await this.service.$node.retrieve(nodeId).catch(NUL404);
                const $conn = await this.service.$connection.retrieve($node?.connId).catch(NUL404);
                return { ...$I, $node, $conn };
            });
        return { id, data };
    };

    /**
     * update the nodes in cluster
     *
     * ```sh
     * $ echo '{"appends":[1]}' | http ':8121/clusters/lemon.bots/nodes'
     * $ echo '{"appends":[1],"removes":[1000007,1]}' | http ':8121/clusters/lemon.bots/nodes'
     * ```
     *
     * @param id    cluster-id like `lemon.monitor`
     */
    public postClustersNodes: NextHandler = async (id, param, body, ctx) => {
        _log(NS, `postClustersNodes(${id})...`);
        const [cluster, stereo] = `${id || ''}`.split('.');
        const appends = body?.appends;
        const removes = body?.removes;
        const data = await $clusters(this.service, null, ctx).updateClusterNodes(cluster, stereo, appends, removes);
        return { id, data };
    };

    /**
     * broadcast `body` to all nodes in `id`
     *
     * ```sh
     * $ echo '{"hello":1}' | http ':8121/clusters/lemon.monitor/broadcast'
     * ```
     * @param id    cluster-id like `lemon.monitor`
     */
    public postClustersBroadcast: NextHandler = async (id, param, body, ctx) => {
        _log(NS, `postClustersBroadcast(${id})...`);
        const [cluster, stereo] = `${id || ''}`.split('.');
        param && _log(NS, `> param =`, $U.json(param));
        const type = `${param?.type || ''}` as ProtocolType;
        const data = await $clusters(this.service, null, ctx).broadcast(cluster, stereo, body, type);
        return { id, data };
    };

    /**
     * post message `body` to the node of `id`
     * - only support for edge/node
     *
     * ```sh
     * $ echo '{"hello":"world"}' | http ':8121/clusters/1000208/message'     # by edge
     * $ echo '{"hello":"world"}' | http ':8121/clusters/ab-cdef/message'     # by node-id
     * $ echo '{"type":"hello"}' | http ':8121/clusters/1000422/message'      # hello of monitor
     * ```
     * @param id    target-id of edge/node.
     */
    public postClustersMessage: NextHandler = async (id, param, body, ctx) => {
        _log(NS, `postClustersMessage(${id})...`);
        id = `${id === '0' ? '' : id || ''}`.trim();
        param && _log(NS, `> param =`, $U.json(param));
        const data = await $clusters(this.service, null, ctx).notify(id, body);
        _log(NS, `> notify[${id}].res =`, $U.json(data));
        return { id, data };
    };

    /**
     * synchronous call to target node.
     * - send message(request), then wait for response.
     *
     * ```sh
     * $ echo '{"hello":"world"}' | http ':8121/clusters/1000161/execute?timeout=5'
     * $ echo '{"id":95,"param":{"sec":1}}' | http ':8121/clusters/1000406/execute?timeout=0'
     * $ echo '{"id":99,"param":{"error":"test"}}' | http ':8121/clusters/1000406/execute?timeout=0'
     * $ echo '{"id":"update"}' | http ':8121/clusters/1000435/execute?timeout=0'               # update the target node.
     * $ echo '{"id":"reboot"}' | http ':8121/clusters/1000502/execute?timeout=0'               # reboot the target node.
     * $ echo '{"id":"check-prime"}' | http ':8121/clusters/1000435/execute?timeout=0&idx=2'
     * ```
     * @param id    target-id of edge/node.
     */
    public postClustersExecute: NextHandler = async (id, param, body, ctx) => {
        _log(NS, `postClustersExecute(${id})...`);
        id = `${id === '0' ? '' : id || ''}`.trim();
        param && _log(NS, `> param =`, $U.json(param));
        const timeout = $U.N(param && param.timeout, -1);
        const idx = $U.N(param && param.idx, 0);
        // eslint-disable-next-line prettier/prettier
        const data = await $clusters(this.service, null, ctx).execute(id, body, timeout >= 0 ? timeout * 1000 : undefined, idx);
        _log(NS, `> execute[${id}].res =`, $U.json(data));
        return data;
    };

    /**
     * for measuring the time performance
     *
     * ```sh
     * # max 2 nodes, and list limit of 3
     * $ echo '{"id":"update"}' | http ':8121/clusters/lemon.bots/requests?max=5&limit=5'
     * $ echo '{"id":"check-prime"}' | http ':8121/clusters/lemon.bots/requests?max=2&limit=3'
     * ```
     * @param id    cluster-id
     */
    public postClustersRequests: NextHandler = async (id, param, body, ctx) => {
        _log(NS, `postClustersRequests(${id})...`);
        id = `${id === '0' ? '' : id || ''}`.trim();
        param && _log(NS, `> param =`, $U.json(param));
        const limit = $U.N(param && param.limit, 1);
        const max = $U.N(param && param.max, 1);
        // eslint-disable-next-line prettier/prettier
        const data = await $clusters(this.service, null, ctx).requests(id, body, limit, max);
        _log(NS, `> requests[${id}].res =`, $U.json(data));
        return data;
    };

    /**
     * test some cases in live
     *
     * ```sh
     * $ http :8121/clusters/send/test
     * ```
     */
    public getClustersTest: NextHandler = async (id, param, body, ctx) => {
        _log(NS, `getClustersTest(${id})...`);
        param && _log(NS, `> param =`, $U.json(param));
        id = id === '0' ? '' : `${id}`.trim();
        switch (id) {
            case 'lock': {
                // return this.service.$clsr.storage.increment('bfbfeeba-d35e-4d86-bcc4-17b3d6f9e270', { lock: 0 }); //! will update { lock, updatedAt: current }
                const _id = this.service.asKey('cluster', 'bfbfeeba-d35e-4d86-bcc4-17b3d6f9e270');
                return this.service.$cluster.storage.storage.update(_id, {}, { updatedAt: 0, lock: 0 }); //! will get the last { lock, updatedAt }
            }
            default:
                break;
        }
    };
}

//! create default instance.
export default new ClustersAPIController(null, true);
