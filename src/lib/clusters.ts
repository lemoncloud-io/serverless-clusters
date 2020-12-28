/**
 * `clusters.ts`
 * - main library for clusters
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 *
 * Copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import $core, { _log, _inf, _err, $U } from 'lemon-core';
import {
    NextContext,
    DDSEvent,
    WSSEvent,
    NUL404,
    ProtocolService,
    ProtocolParam,
    CallbackParam,
    doReportError,
    do_parrallel,
    doReportSlack,
    waited,
    GETERR,
} from 'lemon-core';
import {
    ClusterModel,
    ConnectionInfo,
    ConnectionModel,
    EdgeModel,
    ModelType,
    NodeModel,
    RequestModel,
    ResponseModel,
} from '../service/cluster-model';
import { ClusterService } from '../service/cluster-service';
import {
    extractMeta,
    extractStat,
    MessageHandler,
    MessageHello,
    parseBody,
    parseMessage,
    prepareProtocol,
    ProtocolMessage,
    ProtocolType,
    SimpleSet,
} from './protocol';
import { $base64, buildAGW, convertDDSEvent, convertWSSEvent, parseBase64 } from './tools';
const NS = $U.NS('cluster', 'magenta'); // NAMESPACE TO BE PRINTED.

/**
 * default `cluster` group;
 */
const DEFAULT_CLUSTER = $U.env('DEFAULT_CLUSTER', 'open');

/**
 * default `stereo` name;
 */
const DEFAULT_STEREO = $U.env('DEFAULT_STEREO', 'none');

/**
 * cluster event content
 */
export interface ClusterEvent extends ConnectionInfo {
    /**
     * reguest-id
     */
    id: string;
    type: 'CONNECT' | 'DISCONNECT' | 'MESSAGE' | '';
    route: '$connect' | '$disconnect' | '$default' | '';
    authorization: string;
    stage: 'dev' | 'prod' | '';
    direction: 'IN' | 'OUT' | '';
    reason: string;
    domain: string;
    origin: string;
    agent: string;
    connectionId: string;
    messageId: string;
    apiId: string;
    connectedAt: number;
    /**
     * remote-api address
     */
    remote: string;
    /**
     * query parameters...
     */
    param: { [key: string]: string };
    /**
     * body
     */
    body?: string;
}

/**
 * authorized information.
 */
export interface Authorization {
    /**
     * node-id (= nodeId)
     * - can be '' if initial connection.
     */
    id?: string;
    /**
     * stereo type as `role` in cluster
     * - like `monitor|agent`
     */
    stereo: string;
    /**
     * cluster-id
     * - cluster group to join.
     */
    cluster: string;
}

/**
 * response on connection
 */
export interface ConnectionResponse {
    /**
     * internal node-index.
     */
    i?: number;
    /**
     * id of node (need to save in node for reusing)
     * - save this id into persistence.
     */
    id: string;
    /**
     * cluster-group joined.
     */
    cluster?: string;
}

/**
 * queue service for cluster (not in order)
 */
export interface ClusterQueueService {
    /**
     * enqueue job into `SQS`
     *
     * @param type  see api's cmd
     * @param data  (optional) body data.
     * @param id    (optional) target id.
     */
    enqueue: <T = any>(type: string, data?: T, id?: string) => Promise<string>;

    /**
     * notify job into `SNS`
     *
     * @param type  see api's cmd
     * @param data  (optional) body data.
     * @param id    (optional) target id.
     */
    notify: <T = any>(type: string, data?: T, id?: string) => Promise<string>;
}

interface ClientMessageEvent {
    cluster: string;
    stereo: string;
    $msg: ProtocolMessage;
    $conn: ConnectionModel;
    $node: NodeModel;
    $edge: EdgeModel;
}

/**
 * builder/factory for clustering per each event.
 *
 * @param event   origin event.
 * @param context next-context
 */
export const $clusters = (service: ClusterService, event?: WSSEvent, context?: NextContext) => {
    const $evt = convertWSSEvent(event);
    const $que = new ClusterQueue(context);
    return new Clusters(service, $evt, context, $que);
};

/**
 * basic clusters implementation.
 */
export class Clusters {
    protected service: ClusterService;
    protected event: ClusterEvent;
    protected context: NextContext;
    protected queue: ClusterQueueService;

    /**
     * default constructor()
     */
    public constructor(
        service: ClusterService,
        event: ClusterEvent,
        context: NextContext,
        queue?: ClusterQueueService,
    ) {
        this.service = service;
        this.event = event;
        this.context = context;
        this.queue = queue;
    }

    /**
     * name of this resource.
     */
    public hello = () =>
        // eslint-disable-next-line prettier/prettier
        `clusters:${this.event?.type || ''}:${this.event?.connectionId || ''}${this.service ? ':' + this.service.hello() : ''}`;

    /**
     * get the default configuration.
     */
    public default = () => ({ cluster: DEFAULT_CLUSTER, stereo: DEFAULT_STEREO });

    /**
     * With API Gateway Websocket, send client's response.
     *
     * @param {*} endpoint
     * @param {*} connectionId
     * @param {*} payload
     */
    public postMessage = async (
        endpoint: string,
        connectionId: string,
        payload: any,
        silent?: boolean,
    ): Promise<void> => {
        silent || _log(NS, `postMessage(${endpoint}, ${connectionId})....`);
        if (!endpoint) throw new Error('@endpoint (url) is required!');
        if (!connectionId) throw new Error('@connectionId (string) is required!');
        if (!payload) throw new Error('@payload (string|object) is required!');

        //! default config. (no required to have `region`)
        const agw = buildAGW(endpoint, silent);
        const params = {
            ConnectionId: connectionId, // connectionId of the receiving ws-client
            Data: typeof payload == 'string' ? payload : JSON.stringify(payload),
        };

        //! call agw's posting.
        silent || _log(NS, `> params =`, $U.json(params));
        return agw.postToConnection(params);
    };

    /**
     * post to client
     * @param payload   object or string
     * @param $conn     connection-info
     */
    public postClientMessage = async (payload: any, $conn?: ConnectionInfo) => {
        $conn = $conn || this.event;
        const { stage, domain, connectionId } = $conn;
        if (!domain) throw new Error(`@domain (string) is required!`);
        const url = `https://${domain}/${stage || ''}`;
        return this.postMessage(url, connectionId, payload);
    };

    /**
     * authorize the connection..
     * - basic format is like
     * 1. `<type>:<passcode>`
     * 1. `<type>/<node-id>:<passcode>`
     *
     * @param authorization     encoded authorization code
     * @param event             (optional) original connection-event.
     */
    public onAuthorize = async (authorization: string, event?: ClusterEvent): Promise<Authorization> => {
        authorization = `${authorization || ''}`.replace(/\s+/g, ' ');
        if (!authorization) throw new Error(`@authorization is required!`);
        _inf(NS, `> authorization =`, authorization);
        // event && _inf(NS, `> event =`, $U.json(event));
        event && _inf(NS, `> agent =`, event?.agent || '');
        event && _inf(NS, `> param =`, $U.json(event?.param || ''));
        const $def = this.default();

        //! basic authentication like `type:pass`
        if (authorization.startsWith('Basic ')) {
            const msg = $base64.decode(authorization.substring('Basic '.length));
            const i = msg.indexOf(':');
            const [UID, PWD] = i > 0 ? [msg.substring(0, i), msg.substring(i + 1)].map(_ => _.trim()) : [msg, ''];
            const tokens = UID.indexOf('/') > 0 ? UID.split('/').slice(0, 3) : ['', UID, '']; // [cluster, stereo, id]
            const [_cluster, _stereo, id] = tokens.length < 3 ? ['', ...tokens] : tokens;
            const cluster = `${_cluster || $def.cluster}`;
            const stereo = `${_stereo || ''}`.trim();
            if (!stereo) throw new Error(`@stereo is required - auth-msg:${msg}!`);

            // default passcode as defined `AUTH_PASS`. (use encrypted PASS)
            const DEF = `AUTH_${cluster.toUpperCase()}_PASS`;
            const PWD1 = $core.engine.environ(DEF, ''); //WARN - might be encrypted

            // use the type specific passcode.
            const ENV = `AUTH_${stereo.toUpperCase()}_PASS`;
            const DEF_PWD = stereo === $def.stereo && cluster === $def.cluster ? 'lemon' : '';
            const PWD2 = $core.engine.environ(ENV, PWD1 || DEF_PWD);

            //! check if passcode is valid!.
            if (!PWD2) throw new Error(`@stereo[${stereo}] (string) is invalid - check env:${ENV}`);
            if (PWD !== PWD2) throw new Error(`@pass[${PWD}] (string) is invalid - stereo:${stereo}`);

            //! returns.....................
            return { id, stereo, cluster };
        }

        //! invalid auth...
        throw new Error(`@authorization[${authorization}] is invalid!`);
    };

    /**
     * handle for connection.
     * - required to authorize with <stereo>:<passcode> or <stereo>/<id>:<passcode>
     *
     * 1. in command line.
     * ```sh
     * wscat -c wss://3sl8rd01c3.execute-api.ap-northeast-2.amazonaws.com/dev\?id=1123 --auth agent:lemon --header x-auth:1234
     * ```
     *
     * @param event     (optional) cluster-event to override
     * @returns         any result for internal unit-test.
     */
    public onConnection = async (event?: ClusterEvent): Promise<any> => {
        event = event || this.event;
        // STEP.0 validate!
        const { authorization } = event;

        // STEP.1 authorize, and get core infor!
        const $auth = await this.onAuthorize(authorization, event);
        if (!$auth.cluster) throw new Error(`.cluster is required - onAuthorize(${authorization})`);
        if (!$auth.stereo) throw new Error(`.stereo is required - onAuthorize(${authorization})`);
        const { id, stereo, cluster } = $auth;
        const connectedAt = $U.N(event.connectedAt, this.service.getCurrent());
        _inf(NS, `! authorized - cluster:[${cluster}/${stereo}].node-id =`, id);

        // STEP.2 loading cluster-group.
        const $cluster = await this.service.prepareClusterGroup(cluster, stereo);
        const clusterId = $cluster.clusterId;

        // STEP.3 loading cluster-node.
        const $node = await this.service.prepareClusterNode<ConnectionModel>(
            cluster,
            stereo,
            id,
            { ...event, connectedAt, type: undefined }, //WARN! do not update `type`
            { connected: 1 }, //INFO! use incremental operation (+1)
        );
        const nodeId = $node.nodeId;

        // STEP.4 register node into cluster's nodes.
        if (false) {
            const hasJoined = 1 || ($cluster.Cluster?.nodes || []).includes($node.idx) ? true : false; //WARN! - this will be done via `updateClusterNodes()`
            const $updates: ClusterModel = hasJoined ? {} : { nodes: [$node.idx] };
            const updated = await this.service.$cluster.storage.increment($cluster.clusterId, $updates);
            _log(NS, `> cluster[${clusterId}].nodes :=`, $U.json(updated));
        }

        // STEP.5 send back the response vis SNS (WARN! NOT YET CONNECTED. SO USE `SNS`)
        const $res: ConnectionResponse = { i: $node.idx, id: $node.nodeId, cluster };
        const $msg: ProtocolMessage = prepareProtocol('hello', $res);
        const notified = await this.queue
            ?.notify('message', $msg, `${$node.idx}`) //WARN - use `edge-id` for target-id.
            .then(notified => {
                _inf(NS, `> node[${nodeId}].notified =`, $U.json(notified));
                return notified;
            })
            .catch(e => {
                _err(NS, `> node[${nodeId}].err-notify =`, $U.json(e));
                return `ERR:${GETERR(e)}`;
            });

        //! returns..
        return {
            id,
            nodeId,
            nodes: [],
            notified,
            ...$cluster,
            ...$node,
        };
    };

    /**
     * handle for dis-connected.
     * @param event     (optional) cluster-event to override
     * @returns         any result for internal unit-test.
     */
    public onDisconnected = async (event?: ClusterEvent): Promise<any> => {
        event = event || this.event;
        const { connectionId } = event;
        const reason = `${event?.reason || 'unknown'}`;

        // STEP.0 validate parameters...
        _log(NS, `onDisconnected(${connectionId})`);
        _inf(NS, `> disconnected[${connectionId}].reason =`, reason);
        if (!connectionId) return;

        // STEP.1 update the latest state.
        const $result = await this.service.updateClusterNode<ConnectionModel>(
            { ...event, reason, type: undefined }, //WARN! do not update `type`
            { connected: -1 }, //INFO! use incremental operation (-1)
        );

        // STEP.2 information about cluster.
        const cluster = `${$result.cluster || ''}`;
        const stereo = `${$result.stereo || ''}`;
        const clusterId = this.service.asClusterId(cluster, stereo);

        //! returns..
        return { clusterId, ...$result };
    };

    /**
     * handler for receiving message.
     * @param event     (optional) cluster-event to override
     */
    public onMessage = async (event?: ClusterEvent, debug?: boolean): Promise<any> => {
        event = event || this.event;
        const { id, body, connectionId } = event;

        // STEP.0 validate body, and parse as json.
        const $msg = parseMessage(body);
        _log(NS, `onMessage({${id}})...`);
        // $msg && _log(NS, `> $msg[${connectionId}] =`, $U.json($msg));

        // STEP.1 dispatch target handler per message-type.
        //TODO - improve `read` capacity w/ cache like `redis` @201217(steve)
        const connId = parseBase64(connectionId);
        const $conn: ConnectionModel = await this.service.$connection.retrieve(connId).catch(NUL404);
        const nodeId = `${($conn && $conn.nodeId) || ''}`;
        const $node: NodeModel = nodeId ? await this.service.$node.retrieve(nodeId) : null;
        const edgeId = $node ? this.service.$edge.asEdgeId($node.idx) : '';
        const $edge: EdgeModel = edgeId ? await this.service.$edge.retrieve(edgeId) : null;
        const { cluster, stereo } = { ...$edge };

        // STEP.1-1 returns self-info if `?`
        if ($msg?.type === '?') {
            const data = { id: nodeId, cluster, stereo, Node: $node, Edge: $edge, Connection: $conn };
            return this.postClientMessage({ '!': '?', data }, $node);
        }

        // STEP.2 save the `stat` info to node......
        if ($msg && typeof $msg.stat === 'object' && edgeId) {
            const $stat = extractStat($msg.stat);
            _log(NS, `> edge[${cluster}/${edgeId}/${nodeId}].stat :=`, $U.json($stat));

            //! make sure if new stat has changed!!!!
            const $prev = { ...$edge?.stat };
            const $last = { ...$edge?.stat, ...$stat };
            const $diff = $U.diff($prev, $last);
            const changed = $diff.length > 0 ? true : false;
            (changed ? _inf : _log)(NS, `> edge[${edgeId}].diff =`, $diff.join(','));

            // STEP.2-2 update `stat` only to `edge`.
            const $edges = edgeId ? await this.service.$edge.storage.update(edgeId, { stat: $last }) : null;
            $edges && _inf(NS, `> edge[${cluster}/${edgeId}].updated =`, $U.json($edges));

            //! debug returns........
            if (debug) return { nodeId, data: $msg, $stat, $prev, $last, $diff, $updated: $edge };
        }

        // STEP.2 decode the target function.
        const name = `${$msg?.type || ''}`;
        const target = `on${name.charAt(0).toUpperCase()}${name.substring(1)}`; // must be like `onBroadcast`
        const method: MessageHandler<any, ClientMessageEvent> = (this as any)[target];
        if (typeof method === 'function') return method($msg?.data, { cluster, stereo, $msg, $conn, $node, $edge });

        //! debug returns.
        if (debug) return { nodeId, data: $msg, $conn, $node };

        //! returns..
        $msg && _inf(NS, `> ignore! $msg[${connectionId}] =`, $U.json($msg));
        return;
    };

    /**
     * handler for `hello` message.
     */
    public onHello: MessageHandler<MessageHello, ClientMessageEvent> = async (data, $ctx) => {
        const { cluster, stereo, $node, $edge } = $ctx;

        // STEP.1 extract message.
        const meta = data?.meta;
        const $node1: NodeModel =
            meta !== undefined ? { meta: typeof meta !== 'object' ? `${meta}` : $U.json(meta) } : {};

        // STEP.2 update the target node's infor.
        if (Object.keys($node1)) {
            const $nodes = await this.service.$node.storage.update($node.id, { ...$node1 });
            $nodes && _inf(NS, `> node[${cluster}/${stereo}/${$node.id}].updated =`, $U.json($nodes));
        }

        // STEP.3 update the cloned data into edge.
        if ($edge && meta && typeof meta === 'object') {
            const $edge2: EdgeModel = { meta: extractMeta(meta || {}) };
            const $edges = await this.service.$edge.storage.update($edge.id, { ...$edge2 });
            $edges && _inf(NS, `> edge[${cluster}/${stereo}/${$edge.id}].updated =`, $U.json($edges));
        }
    };

    /**
     * handler for `response` message.
     */
    public onResponse: MessageHandler<any, ClientMessageEvent> = async (data, $ctx) => {
        const { $edge, $msg } = $ctx;
        _log(NS, `onResponse(${$msg?.id})`);

        // STEP.3 check if valid response.....
        if ($msg && $msg.id) {
            // STEP.3-1 validate response..
            const resId = `${$msg.id || ''}`;
            const reqId = resId.includes('/') ? resId.split('/')[0] : resId; // like `ab-cd/1`. '1' means index of request.
            const idx = resId.includes('/') ? $U.N(resId.split('/')[1], 0) : 0; // use as `.idx`.
            const $req: RequestModel = reqId ? await this.service.$request.retrieve(reqId).catch(NUL404) : null;

            // STEP.3-2 save response. and mark finished.
            if ($req) {
                const key$ = this.service.asKey$('response', resId);
                const $res0: ResponseModel = {
                    ...key$,
                    ...this.service.$response.storage.storage.asTime(),
                    stereo: $req.stereo,
                    rid: reqId,
                    idx,
                    source: `${$edge?.id || ''}`,
                    error: typeof $msg.error != 'object' ? `${$msg.error || ''}` : $U.json($msg.error),
                    data: typeof $msg.data != 'object' ? `${$msg.data || ''}` : $U.json($msg.data),
                    deletedAt: 0,
                };
                const finishedAt = $res0.updatedAt;
                const $res = await this.service.$response.storage.update(resId, $res0); // it will update (or create) model.
                _log(NS, `> $res[${resId}] =`, $U.json($res));

                // STEP.3-3 mark finished of request.
                const marked = await this.service.$request.storage.update(reqId, { finishedAt }, { finished: 1 }); //! increments `.finished`
                _log(NS, `> $req[${reqId}].marked =`, $U.json(marked));
            }
        }
        // FINAL. ends up `response` message.
        return;
    };

    /**
     * update the joined nodes in cluster[]
     *
     * @param cluster   target cluster
     * @param stereo    stereo group
     * @param appends   id of edge
     * @param removes   id of edge
     */
    public updateClusterNodes = async (cluster: string, stereo: string, appends: number[], removes: number[]) => {
        _log(NS, `updateClusterNodes(${cluster}/${stereo})..`);
        // STEP.0 validate parameters.
        if (!cluster) throw new Error(`@cluster (string) is required!`);
        appends = (appends || []).map(i => $U.N(i, 0)).filter(i => i > 0);
        removes = (removes || []).map(i => $U.N(i, 0)).filter(i => i > 0);
        appends && _log(NS, `> appends =`, appends.join(', '));
        removes && _log(NS, `> removes =`, removes.join(', '));

        // STEP.1 read the target model.
        const { clusterId, Cluster: $cluster } = await this.service.prepareClusterGroup(cluster, stereo);
        _log(NS, `> cluster[${clusterId}]=`, $U.json($cluster));

        // STEP.2 calculate the index to removes.
        const nodes = $cluster?.nodes || [];
        const $add: number[] = 1 ? appends : appends.filter(i => !nodes.includes(i));
        const $rem: number[] =
            removes.length > 0
                ? nodes
                      .map((n, i) => ({ t: removes.includes(n), i }))
                      .filter(n => n.t)
                      .map(n => n.i)
                : null;

        //TODO - improve `Invalid UpdateExpression: Two document paths overlap with each other; must remove or rewrite one of these paths; path one: [nodes], path two: [nodes, [135]]`
        // STEP.2 update w/ query.
        // const $updated = await this.service.$cluster.storage.storage.increment(
        //     $cluster._id,
        //     { nodes: [...appends] },
        //     $rem ? ({ nodes: { removeIndex: $rem } } as any) : {},
        // );
        // _log(NS, `> $updated[${clusterId}] =`, $U.json($updated));

        // STEP.2-1 remove from nodes
        if ($rem && $rem.length > 0) {
            const $removed = await this.service.$cluster.storage.storage.increment($cluster._id, { deletedAt: 0 }, {
                nodes: { removeIndex: $rem }, //WARN - required `lemon-core#2.2.15`
            } as any);
            _log(NS, `> $removed[${clusterId}] =`, $U.json($removed));
            $cluster.nodes = ($cluster.nodes || []).filter((n, i) => !$rem.includes(i));
        }

        // STEP.2-2 append into nodes
        if ($add && $add.length > 0) {
            const $appened = await this.service.$cluster.storage.storage.increment($cluster._id, {
                nodes: [...$add],
                deletedAt: 0,
            });
            _log(NS, `> $appened[${clusterId}] =`, $U.json($appened));
            $cluster.nodes = $appened.nodes;
        }

        // returns..
        return { cluster, stereo, clusterId, Cluster: { ...$cluster } };
    };

    /**
     * broadcast message to all.
     *
     * @param cluster   target cluster's name
     * @param stereo    target group to send.
     * @param data      payload to send.
     * @param type      default to 'broadcast'
     */
    public broadcast = async (
        cluster: string,
        stereo: string,
        data?: ProtocolMessage,
        type?: ProtocolType,
    ): Promise<number> => {
        _log(NS, `broadcast(${cluster}/${stereo})..`);
        // STEP.0 validate parameters.
        type = type || 'broadcast';
        if (!cluster) throw new Error(`@cluster (string) is required!`);
        data && _log(NS, `> data[${cluster}/${stereo}] =`, $U.json(data));

        // STEP.1 prepare message to be sent.
        const $msg = prepareProtocol(type, data);
        if (type === 'broadcast') delete $msg.type; //! clear `.type` only if broadcast.

        // STEP.2 reat all `.nodes` of cluster.
        const { clusterId, Cluster: $cluster } = await this.service.prepareClusterGroup(cluster, stereo);
        _log(NS, `> cluster[${clusterId}]=`, $U.json($cluster));

        const nodes = $cluster?.nodes;
        if (!nodes || nodes.length < 1) return 0;

        // STEP.2-1 cleanup the `duplicated` idx in nodes @201209.
        const $last = nodes.reduce((L: number[], n) => {
            if (!L.includes(n)) L.push(n);
            return L;
        }, []);

        // STEP.3 send msg to all nodes.
        const perEach = async (idx: number): Promise<{ i: number; error?: Error }> => {
            const edgeId = idx ? this.service.$edge.asEdgeId(idx) : '';
            const $edge = edgeId ? await this.service.$edge.retrieve(edgeId) : null;
            //! if valid, post msg...
            if ($edge && $edge.connectionId) {
                return this.postClientMessage($msg, $edge)
                    .then(() => {
                        return { i: idx };
                    })
                    .catch(e => {
                        const error = e instanceof Error ? GETERR(e) : e;
                        if (error?.message === '410') return { i: idx }; //! ignore if `GoneException`
                        _err(NS, `>> node[${idx}].err =`, $U.json(error));
                        return { error: e, i: idx, $edge };
                    });
            }
            return { i: idx };
        };
        const sents: { i: number; error?: Error }[] = (await do_parrallel($last, perEach, 20)) as any;

        // STEP.4 if on error. do something....
        const errors = sents.filter(N => N && N.error);
        errors.length && _err(NS, `! errors.len =`, $U.json(errors.map(N => `${N.i}:${N.error}`)));
        if (errors.length > 0)
            await doReportError(errors[0].error, this.context, null, { cluster, stereo, $msg, sents }).catch(GETERR);

        //! returns........
        return sents.length;
    };

    /**
     * find the target-node by id string (or number)
     * @param id
     */
    public findNode = async (id: string | number) => {
        // STEP.0 validate parameters..
        const idx = typeof id === 'number' ? id : /^[1-9][0-9]{3,}$/.test(id) ? $U.N(id, 0) : 0;
        const edgeId0 = idx > 0 ? this.service.$edge.asEdgeId(idx) : '';
        const nodeId0 = idx > 0 ? '' : `${id}`;

        const $edge = edgeId0 ? await this.service.$edge.retrieve(edgeId0) : null;
        const $node = nodeId0 ? await this.service.$node.retrieve(nodeId0) : null;

        // STEP.1 find the target node.
        const $con: ConnectionInfo = $edge || $node;
        _log(NS, `> conn[${id}] =`, $U.json($con));
        if (!$con) throw new Error(`404 NOT FOUND - node[${id}]`);

        // STEP.2 find the key-ids.
        const connId = parseBase64($con.connectionId);
        const nodeId = $node ? $node.id : $edge ? $edge.nodeId : '';
        const edgeId = $edge ? $edge.id : $node ? this.service.$edge.asEdgeId($node.idx) : '';
        const edge = $edge ? $edge.idx : $node ? $node.idx : 0;
        const stereo = $edge ? $edge.stereo : $node ? $node.stereo : '';
        const cluster = $edge ? $edge.cluster : '';

        //! returns..
        return { id, idx: edge, connId, nodeId, edgeId, $con, stereo, cluster };
    };

    /**
     * synchronous call to target node.
     *
     * @param id        target-id of edge/node.
     * @param data      payload
     * @param timeout   timeout... (default 10 sec, max 60 sec)
     * @param idx       (optiona) sub-index of request.
     */
    public execute = async <T = any>(id: string, data: T, timeout?: number, idx?: number): Promise<RequestModel> => {
        timeout = $U.F(timeout, 10 * 1000);
        timeout = Math.min(timeout, 60 * 1000);
        idx = $U.N(idx, 0);
        _log(NS, `execute(${id || ''}, ${timeout})...`);
        const INTERVAL = 1 ? 100 : 200; // 200 ms   (50ms * 10 sec => consume 1.5 capacity)
        const MAX_TICK = timeout > 0 ? Math.ceil((1.0 * timeout) / INTERVAL) : 0;
        _log(NS, `> MAX_TICK =`, MAX_TICK);

        // // STEP.0 validate.........
        const { $con, edgeId, stereo, cluster } = await this.findNode(id);
        const reqId = this.service.nextUuid(); // make new request-id
        const async = MAX_TICK > 0 ? data && (data as any).async : true; //! might use.
        const $msg = prepareProtocol('request', { ...data, async }, idx ? `${reqId}/${idx}` : reqId);

        // STEP.1 prepare `request` model, and mark.
        const key$ = this.service.asKey$('request', reqId);
        const $req0: RequestModel = {
            ...key$,
            ...this.service.$request.storage.storage.asTime(),
            idx,
            cluster,
            stereo,
            target: edgeId, //! prefer to `edge-id`
            error: '',
            requested: 1, //! must be single request.
            finished: 0,
            finishedAt: 0,
            deletedAt: 0,
        };
        const $req = await this.service.$request.storage.update(reqId, $req0);
        _log(NS, `> $req[${reqId}] =`, $U.json($req));

        // STEP.2 send message to `node`.
        const error: string = await this.postClientMessage($msg, $con)
            .then(() => null)
            .catch(e => {
                const error = e instanceof Error ? GETERR(e) : e;
                if (error?.message === '410')
                    return Promise.reject(new Error(`404 NOT FOUND - edge-id[${edgeId}]:${id}`));
                _err(NS, `> err.post =`, e);
                return typeof e == 'string' ? e : $U.json(e);
            });

        //! returns if fail to send or no-wait.
        if (error) return { ...$req, error };
        if (MAX_TICK <= 0) return { ...$req };

        // STEP.3 polling if done until timeout
        const checkFinishedAt = async (id: string): Promise<boolean> => {
            const $new: RequestModel = await this.service.$request.storage.read(id).catch(NUL404);
            const finished = $U.N($new && $new.finished, 0);
            // _log(NS, `>> finished[${id}] =`, $new?.finished);
            if (finished > 0) {
                $req.finished = $new.finished;
                $req.finishedAt = $new.finishedAt;
                $req.updatedAt = $new.updatedAt;
            }
            return finished > 0 ? true : false;
        };
        let last_checked = $U.current_time_ms();
        for (let tick = 0; tick < MAX_TICK; tick++) {
            const diff = $U.current_time_ms() - last_checked;
            if (diff < INTERVAL) await waited(diff > 0 ? INTERVAL - diff : INTERVAL);
            last_checked = $U.current_time_ms();
            const fin = await checkFinishedAt(reqId);
            if (fin) break;
        }

        // STEP.4 pull result, or throw.
        const $res = await this.service.$response.storage.read(reqId).catch(NUL404);
        _log(NS, `> $res[${reqId}] =`, $U.json($res));
        if ($res) {
            const { error, body } = $res;
            $req.error = error || $req.error;
            return { ...$req, Response: parseBody(body) };
        } else {
            $req.error = `timeout(${Math.round((timeout / 1000.0) * 100) / 100.0})`;
        }

        //! returns...
        return { ...$req };
    };

    /**
     * send the duplicated requests
     *
     * @param id        target-id of edge/node.
     * @param data      payload
     * @param limit     limit of list
     * @param max       (optiona) max number of nodes
     */
    public requests = async <T = any>(id: string, data: T, limit?: number, max?: number) => {
        limit = $U.N(limit, 1);
        limit = Math.min(limit, 2000);
        max = $U.N(max, 0);
        _log(NS, `requests(${id || ''}, ${limit})...`);

        // STEP.0 validate.........
        const $cluster = await this.service.$cluster.retrieve(id);
        const { cluster, stereo, id: clusterId } = $cluster;

        // STEP.1 prepare `request` model, and mark.
        const reqId = this.service.nextUuid(); // make new request-id
        const key$ = this.service.asKey$('request', reqId);
        const $req0: RequestModel = {
            ...key$,
            ...this.service.$request.storage.storage.asTime(),
            idx: max,
            cluster,
            stereo,
            target: clusterId, //! prefer to `edge-id`
            error: '',
            requested: limit, //! must be single request.
            finished: 0,
            finishedAt: 0,
            deletedAt: 0,
        };
        const $req = await this.service.$request.storage.update(reqId, $req0);
        _log(NS, `> $req[${reqId}] =`, $U.json($req));

        // STEP.2 prepares messages to `node`.
        const range = (n: number): number[] => [...Array(n).keys()];
        const async = true; //! might use.
        const $msgs = range(limit).map(i => prepareProtocol('request', { ...data, async }, `${reqId}/${i}`));

        // STEP.3 spread to nodes..
        const nodes = $cluster.nodes || [];
        if (nodes.length < 1) throw new Error(`404 NOT FOUND - cluster[${id}].nodes is empty!`);

        const $edges: EdgeModel[] = await Promise.all(
            nodes.slice(0, max).map(i => this.service.$edge.retrieve(this.service.$edge.asEdgeId(i)).catch(NUL404)),
        );
        const LEN = $edges.length;
        if (LEN <= 0) throw new Error(`@max[${max}] (number) is required!`);

        // STEP.4 wait for all msg sent.
        const mkFunc = (i: number, j: number) =>
            $edges[j] &&
            this.postClientMessage($msgs[i], $edges[j])
                .then(() => null)
                .catch(GETERR);
        const alls = await Promise.all($msgs.map((M, i) => mkFunc(i, i % LEN)));

        //! returns...
        return { $req, alls: 1 ? alls : $msgs };
    };

    /**
     * asynchronous send message to target.
     *
     * @param id    target-id of edge/node.
     * @param $msg  payload
     */
    public notify = async (id: string, $msg: ProtocolMessage) => {
        if (!$msg) throw new Error(`@data (protocol-message) is required - notify()`);
        const type = $msg.type;

        // STEP.1 find the target node.
        const { idx, $con, edgeId, nodeId, cluster, stereo } = await this.findNode(id);

        // STEP.2 send back the initial stat for `monitor` set. @201217
        if (cluster && stereo === 'monitor' && type === 'hello') {
            //TODO - search nodes not in `monitor`, or major stereo.
            const clusterId = this.service.asClusterId(cluster, 'bots');
            const $clust = await this.service.$cluster.retrieve(clusterId);
            const nodes = ($clust.nodes || []).slice(0, 32); //TODO - prevent so many results..
            const list: EdgeModel[] = (await do_parrallel(
                nodes,
                async idx => {
                    const edgeId = this.service.$edge.asEdgeId(idx);
                    const $edge: EdgeModel = await this.service.$edge.retrieve(edgeId).catch(() => null);
                    return $edge;
                },
                10,
            )) as any;
            const data = ($msg.data = $msg.data || {});
            //! merge `meta` of edge for display properties..
            data.list = list
                .filter(N => !!N)
                .map(N => ({ i: N.idx, stat: { ...N.stat }, meta: { ...N.meta }, name: N.name }));
        }

        // STEP.3 send message..
        const sent = await this.postClientMessage($msg, $con).catch(e => {
            const error = e instanceof Error ? GETERR(e) : e;
            if (error?.message === '410') return Promise.reject(new Error(`404 NOT FOUND - cluster-id[${idx}]:${id}`));
            throw e;
        });
        _log(NS, `> sent[${id}] =`, $U.json(sent));

        //! returns..
        return { idx, nodeId, edgeId, sent, $msg };
    };

    /**
     * try to disconnect the target node.
     * @param id
     */
    public disconnect = async (id: string) => {
        _log(NS, `disconnect(${id})`);
        if (!id) throw new Error(`@id (string) is required!`);
        // STEP.1 find the target node.
        const { idx, $con } = await this.findNode(id);

        // STEP.2 call disconnect.
        const { stage, domain, connectionId: ConnectionId } = $con;
        if (!domain) throw new Error(`@domain (string) is required!`);
        const url = `https://${domain}/${stage || ''}`;
        const agw = buildAGW(url, false);

        // STEP.3 call api.
        return agw.deleteConnection({ ConnectionId }).catch(e => {
            const error = e instanceof Error ? GETERR(e) : e;
            if (error?.message === '410') return Promise.reject(new Error(`404 NOT FOUND - cluster-id[${idx}]:${id}`));
            throw e;
        });
    };

    /**
     * run and return response.
     */
    public run = async (): Promise<any> => {
        const event = this.event;
        if (!event || !event.id) throw new Error(`@event is required - run()!`);
        const { type } = event;
        if (!type) {
            throw new Error(`@type (string) is required - run()!`);
        } else if (type == 'CONNECT') {
            return this.onConnection(event).then(() => undefined);
        } else if (type == 'MESSAGE') {
            return this.onMessage(event).then(() => undefined); //! return must be 'void'
        } else if (type == 'DISCONNECT') {
            return this.onDisconnected(event).then(() => undefined); //! return must be 'void'
        } else {
            throw new Error(`@type[${type}] is invalid!`);
        }
    };

    /**
     * handle for dynamo-stream.
     * - aggregate the `connected` or `disconnected` node => update the child nodes.
     * - aggregate the `stat` => broadcast to `monitor`
     * @param event DynamoDBStream Event
     */
    public dynamo = async (event: DDSEvent): Promise<any> => {
        if (!event || !event.Records) throw new Error(`@event is required - dynamo()!`);
        // STEP.1 transform the origin event.
        const { nodes } = convertDDSEvent(event);
        const TABLE = $U.env('MY_DYNAMO_TABLE', 'Clusters');

        // STEP.2 update the connected `edge` of clusters.
        if (1) {
            _log(NS, `> update connected nodes`);
            const TYPE: ModelType = 'edge';

            // STEP.2-1 extract the last `connected` edges.
            const $last = nodes
                .map(N => {
                    const { table, last, diff } = N;
                    const edge: EdgeModel = table === TABLE && last && last.id && last.type === TYPE ? last : null;
                    return edge && diff.includes('connected') ? edge : null;
                })
                .filter(N => !!N)
                .reduce((M: { [key: number]: EdgeModel }, model) => {
                    const idx = model.idx;
                    if (!idx) idx;
                    else if (M[idx] === undefined) M[idx] = model;
                    else if (M[idx].updatedAt <= model.updatedAt) M[idx] = model;
                    return M;
                }, {});
            _log(NS, `>> $last[${TYPE}] =`, $U.json($last));

            // STEP.2-2 summarize by `cluster-id`.
            const $sums = Object.values($last).reduce((M: { [key: string]: { A: number[]; D: number[] } }, N) => {
                const { cluster, stereo, connected, idx } = N;
                const cid = this.service.asClusterId(cluster, stereo);
                const $M = M[cid] || { A: [], D: [] };
                if (connected && connected > 0) $M.A.push(idx);
                else $M.D.push(idx);
                M[cid] = $M;
                return M;
            }, {});
            _log(NS, `>> $sums[${TYPE}] =`, $U.json($sums));

            //! REPORT OF NODES CHANGED THE CONNECTED.
            if (TYPE) {
                const $last = nodes
                    .map(N => {
                        const { table, last, diff } = N;
                        const edge: EdgeModel = table === TABLE && last && last.id && last.type === TYPE ? last : null;
                        return edge && diff.includes('connected') ? edge : null;
                    })
                    .filter(N => !!N)
                    .map(N => ({ ...N, stat: undefined, _id: undefined }));
                if ($last.length > 0) {
                    const tt = new Date().getTime();
                    const ts = $U.ts(tt);
                    // eslint-disable-next-line prettier/prettier
                    const conns = $last.filter(N => N.connected !== undefined && N.connected > 0).map(N => `${N.idx}:${N.connected}`).join(' ');
                    // eslint-disable-next-line prettier/prettier
                    const discs = $last.filter(N => N.connected !== undefined && N.connected <= 0).map(N => `${N.idx}:${N.connected}`).join(' ');
                    const lines = [
                        ['in', conns],
                        ['out', discs],
                    ]
                        .filter(N => !!N[1])
                        .map(N => `${N[0]}:\`${N[1]}\``);
                    doReportSlack('cluster', {
                        attachments: [
                            {
                                // eslint-disable-next-line prettier/prettier
                                title: `_${$U.ts().substr(14,5)}_ ${TYPE} - ${lines.join(' ')}`,
                                text: $U.json({ nodes: $last, sums: $sums, ts, tt }),
                            },
                        ],
                    }).catch(GETERR);
                }
            }

            // STEP.2-3 build actions....
            const alls = Object.keys($sums)
                .map(id => ({ id, data: { appends: $sums[id]?.A, removes: $sums[id]?.D } }))
                .map(M => this.queue.enqueue('nodes', M.data, M.id));

            // STEP.2-4 enqueue via protocol
            const onERR = (e: Error) =>
                doReportError(e, this.context, event, { $last, $sums })
                    .then(() => `ERR:${GETERR(e)}`)
                    .catch(e2 => `ERR:${GETERR(e)}/${GETERR(e2)}`);
            const $queued = alls.length > 0 ? await Promise.all(alls).catch(onERR) : null;
            $queued && _inf(NS, `>> $queued =`, $U.json($queued));
        }

        // STEP.3 build the `stat` per each edge, then broadcast
        if (1) {
            _log(NS, `> broadcast the updated stat`);
            const TYPE: ModelType = 'edge';
            // STEP.3-1 extract the last `stat` edge.
            const $last = nodes
                .map(N => {
                    const { table, last, diff } = N;
                    const node: EdgeModel = table === TABLE && last && last.id && last.type === TYPE ? last : null;
                    return node && diff.includes('stat') ? node : null;
                })
                .filter(N => !!N)
                .reduce((M: { [key: number]: EdgeModel }, model) => {
                    const idx = model.idx;
                    if (!idx) idx;
                    else if (M[idx] === undefined) M[idx] = model;
                    else if (M[idx].updatedAt <= model.updatedAt) M[idx] = model;
                    return M;
                }, {});
            _log(NS, `>> $last[${TYPE}] =`, $U.json($last));

            // STEP.3-2 summarize by `cluster-id`.......
            const $sums = Object.values($last).reduce((M: { [key: string]: { stat: SimpleSet; i: number }[] }, N) => {
                const { cluster, stereo, stat, idx: i } = N;
                if (!cluster) return M;
                const cid = this.service.asClusterId(cluster, 0 ? stereo : 'monitor'); //! force to report to `monitor` in this cluster.
                const list = M[cid] || [];
                list.push({ stat, i });
                M[cid] = list;
                return M;
            }, {});
            _log(NS, `>> $sums[${TYPE}] =`, $U.json($sums));

            // STEP.3-3 build actions....
            const alls = Object.keys($sums)
                .map(id => ({ id, data: { list: $sums[id], type: 'stat' } }))
                .map(M => this.queue.notify('broadcast', M.data, M.id));

            // STEP.3-4 enqueue via protocol...
            const onERR = (e: Error) =>
                doReportError(e, this.context, event, { $last, $sums })
                    .then(() => `ERR:${GETERR(e)}`)
                    .catch(e2 => `ERR:${GETERR(e)}/${GETERR(e2)}`);
            const $queued = alls.length > 0 ? await Promise.all(alls).catch(onERR) : null;
            $queued && _inf(NS, `>> $queued =`, $U.json($queued));
        }

        //! returns..
        return;
    };
}

/**
 * default `ClusterQueue`
 */
export class ClusterQueue implements ClusterQueueService {
    public readonly context: NextContext;
    public constructor(context: NextContext) {
        this.context = context;
    }

    /**
     * prepare objectss.
     */
    public prepare = (cmd: string, id: string, param: any, body?: any) => {
        const service: ProtocolService = $core.cores.protocol.service;
        // eslint-disable-next-line @typescript-eslint/no-inferrable-types
        const endpoint = `api://lemon-clusters-api/clusters/${id || '0'}${cmd ? '/' : ''}${cmd || ''}`;
        const protocol: ProtocolParam = service.fromURL(this.context, endpoint, param, body);
        const callback: CallbackParam = 1 ? null : { type: 'clusters', id };
        protocol.mode = 'POST';
        return { service, endpoint, protocol, callback };
    };

    /**
     * enqueue into `SQS` named as `lemon-clusters-sqs` (prod)
     *
     * @param type  see api's cmd
     * @param data  (optional) body data.
     * @param id    (optional) target id.
     */
    public enqueue = <T = any>(type: string, data?: T, id?: string): Promise<string> => {
        const { service, protocol, callback } = this.prepare(type, `${id || ''}`, null, { ...data });
        return service.enqueue(protocol, callback);
    };

    /**
     * notify msg via `SNS` named as `lemon-clusters-sns` (prod)
     *
     * @param type  see api's cmd
     * @param data  (optional) body data.
     * @param id    (optional) target id.
     */
    public notify = <T = any>(type: string, data?: T, id?: string): Promise<string> => {
        const { service, protocol, callback } = this.prepare(type, `${id || ''}`, null, { ...data });
        return service.notify(protocol, callback);
    };
}
