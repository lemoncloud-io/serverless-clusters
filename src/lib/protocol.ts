/**
 * `protocol.ts`
 * - spec of protocol for clusters between server and client.
 *
 * @see         `lemon-clusters-api#protocol.ts` for origin.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-11-27 initial version.
 * @date        2020-12-16 optimized for message format.
 * @date        2020-12-17 optimized `hello` protocol and message-handler.
 * @date        2020-12-22 optimized `async` requests w/ stack.
 *
 * Copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { $U, _err, _inf, _log, GETERR, GETERR$, doReportError } from 'lemon-core';
import { Stack } from './stack';
const NS = $U.NS('PROT', 'blue'); // NAMESPACE TO BE PRINTED.

//! global memory to save the static time.
const $conf = { ts: 0, totalRAMSize: 0 };
export const now = (ts?: number) => (ts ? ($conf.ts = ts) : $conf.ts ? $conf.ts : new Date().getTime());

/**
 * type: stat-entries
 * - save stat info
 */
export interface SimpleSet {
    [key: string]: number | string;
}

/**
 * type of protocol.
 * S: server, N: node
 *
 * - ?: N -> S          : send back the node infor.
 * - hello: S <-> N     : send back on connection.
 * - broadcast: S -> N  : broadcast msg to all.
 * - stat: S <-> N      : report stat of node.
 * - request: S -> N    : request to peer.
 * - response: N -> S   : response for request-id.
 */
export type ProtocolType = '' | '?' | '!' | 'hello' | 'broadcast' | 'stat' | 'request' | 'response';

export interface ProtocolHeader<U = ProtocolType> {
    /**
     * message-type.
     */
    type: U;
}

/**
 * `ProtocolMessage`
 * - definitions of protocol-message between each peer.
 * - message limit is `32kb`
 */
export interface ProtocolMessage<T = any, U = ProtocolType> extends ProtocolHeader<U> {
    /**
     * (optional) message-id
     */
    id?: string;

    /**
     * message payload..
     */
    data?: T;

    /**
     * payload messages in list.
     * //TODO - support in bulk list of request.
     */
    list?: T[];

    /**
     * timestamp number of protocol created.
     */
    ts?: number;

    /**
     * might have `stat` in addition.
     */
    stat?: SimpleSet;

    /**
     * (optional) if got error...
     */
    error?: any;
}

/**
 * prepare protocol-message
 */
export const prepareProtocol = <T = any, U = ProtocolType>(type: U, data: T, id?: string): ProtocolMessage<T, U> => ({
    type,
    data,
    ts: now(),
    id,
});

/**
 * prepare request-message.
 * @param id    unique request-id
 * @param data  payload
 */
export const prepareRequest = <T = any>(id: string, data?: T): ProtocolMessage<T> => {
    id = `${id || ''}`.trim();
    if (!id) throw new Error(`@id (string) is required!`);
    return prepareProtocol('request', data, id);
};

/**
 * prepare response-message.
 * @param req   the source request.
 * @param data  payload
 */
export const prepareResponse = <T = any>(req: ProtocolMessage, data?: T): ProtocolMessage<T> => {
    if (!req) throw new Error(`@req (request-model) is required!`);
    const { id } = req;
    if (!id) throw new Error(`.id (string) is required!`);
    return prepareProtocol('response', data, id);
};

/**
 * parse the encoded json to JSON.
 * @param body any data
 */
export const parseBody = (body: any, key: string = 'body') => {
    try {
        return body && typeof body == 'string' && body.startsWith('{') && body.endsWith('}')
            ? JSON.parse(body)
            : { [key]: body };
    } catch (e) {
        return { [key]: body, error: GETERR(e) };
    }
};

/**
 * parse the recieved message
 * @param data string | object
 */
export const parseMessage = <T = any>(data: any): ProtocolMessage<T> => {
    if (typeof data !== 'string') return { type: '', data: data as T };
    const $cmd = !data.startsWith('{') ? { type: data } : parseBody(data, 'data'); //! data must be `string`
    const type = `${($cmd && ($cmd.type || $cmd['!'])) || ''}` as ProtocolType;
    return { ...$cmd, type };
};

/**
 * extract properties only in string|number.
 * @param N  any object.
 */
export const extractStat = (N: any) =>
    Object.keys(N).reduce((M: SimpleSet, key) => {
        const val = N[key];
        if (val === null || val === '') M[key] = null;
        else if (typeof val === 'number' || typeof val === 'string') M[key] = val;
        return M;
    }, {});

/**
 * extract properties only in string|number.
 * @param N  any object.
 */
export const extractMeta = (N: any) =>
    Object.keys(N).reduce((M: SimpleSet, key) => {
        const val = N[key];
        if (typeof val === 'number' || typeof val === 'string') M[key] = val;
        return M;
    }, {});

//! check diskspace of root.
export const checkDiskSpace = (
    root: string = '/',
): Promise<{ total: number; used: number; free: number; status: string }> =>
    new Promise((resolve, reject) => {
        const disk = require('diskspace');
        disk.check(root, (err: any, data: any) => {
            if (err) reject(err);
            else resolve(data);
        });
    });

//! get disk usage(%).
export const checkDiskUsage = async (root: string = '/'): Promise<number> => {
    const { total, used } = await checkDiskSpace(root);
    const usage = total > 0 ? Math.round((1000.0 * used) / total) / 10.0 : 0;
    return usage;
};

//! get cpu usage(%)
export const checkCPUUsage = (): Promise<number> =>
    new Promise(resolve => {
        const os = require('os-utils');
        os.cpuUsage((_: number) => resolve(Math.round(_ * 1000) / 10.0));
    });

//! get ram usage(%)
export const checkRAMUsage = (): Promise<number> =>
    new Promise(resolve => {
        const os = require('os-utils');
        const total = $conf.totalRAMSize || ($conf.totalRAMSize = os.totalmem());
        const free = os.freemem();
        const usage = total > 0 ? Math.round((1000.0 * (total - free)) / total) / 10.0 : 0;
        resolve(usage);
    });

//! check all usage.
export const checkUsage = async (): Promise<SimpleSet> => {
    const names = ['disk', 'cpu', 'ram'];
    const ERR0 = (): number => 0;
    const alls = [
        () => checkDiskUsage().catch(ERR0),
        () => checkCPUUsage().catch(ERR0),
        () => checkRAMUsage().catch(ERR0),
    ];
    const $res = await Promise.all(alls.map((f, i) => f().then(m => ({ [names[i]]: m }))));
    const $ret: SimpleSet = $res.reduce((M, I) => ({ ...M, ...I }), {});
    return $ret;
};

//! check the current network.
export const checkNetworks = async () => {
    const os = require('os');
    const ifaces = os.networkInterfaces();

    const addrs: { name: string; addr: string; mac: string }[] = [];
    Object.keys(ifaces).forEach((ifname: string) => {
        var alias = 0;
        ifaces[ifname].forEach((iface: any) => {
            // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
            if ('IPv4' !== iface.family || iface.internal !== false) return;
            const name = alias >= 1 ? `${ifname}:${alias}` : ifname;
            const addr = iface.address;
            const mac = iface.mac || '';
            addrs.push({ name, addr, mac });
            ++alias;
        });
    });

    //! returns..
    return addrs;
};

//! check the current package status.
export const checkPackage = async () => {
    const fs = require('fs');
    const $stat = fs.statSync('package.json');
    const $pack = JSON.parse(fs.readFileSync('package.json', { encoding: 'utf8' }).toString());
    const modified = $U.ts($U.F($stat.ctimeMs, 0));
    const name = $pack.name || 'LEMON API';
    const version = $pack.version || '0.0.0';
    const core = `${($pack.dependencies && $pack.dependencies['lemon-core']) || ''}`;
    const stage = $U.env('STAGE', 'local');
    //! returns;;
    return { name, version, core: core.startsWith('^') ? core.substring(1) : core, stage, modified };
};

/**
 * request handler-method
 */
type RequestHandler = MessageHandler<MessageRequest, undefined, any>;

/**
 * run request
 * @param $req  request-message...
 * @returns     string message if failed.
 */
const runReqTarget = async (
    thiz: ProtocolChannel,
    $req: ProtocolMessage<MessageRequest>,
    target: RequestHandler,
): Promise<string> => {
    try {
        const $res = prepareResponse($req);
        const $ret = target($req.data, undefined);
        const chained = typeof $ret === 'object' && $ret instanceof Promise ? $ret : Promise.resolve($ret);
        return chained
            .then(data => ({ data }))
            .catch(GETERR$) //! got like `{ error }`
            .then(N => ({ ...$res, ...N }))
            .then(M => thiz.post(M))
            .then(() => '');
    } catch (e) {
        _err(NS, `! ERR[${$req?.id || ''}] =`, e);
        return doReportError(e, null, { $req }, { message: `fail to handle request` }).catch(GETERR);
    }
};

/**
 * run worker thread (must be single-thread in node 10)
 *
 * @param thiz      the main client
 * @param target    target function to handle
 * @param timeout   (optional) default timeout=5
 */
const runWorker = (thiz: ProtocolClient, target: RequestHandler, timeout: number = 5) => {
    setTimeout(() => {
        const $req = thiz.$stack.bottom && thiz.$stack.bottom.value;
        if ($req) {
            runReqTarget(thiz, $req, target)
                //! remove bottom, then trigger again.
                .then(() => (thiz.$stack.pull() ? runWorker(thiz, target, timeout) : null))
                .catch(e => _err('! ERR @runWorker=', e));
        }
    }, timeout);
};

/**
 * communication channel.
 * - channel between client and server via web-socket.
 */
export interface ProtocolChannel {
    /**
     * get id of this channel
     */
    id: () => string;

    /**
     * post message via this channel w/o return message
     *
     * @param msg message to post
     */
    post: <T = any>(msg: ProtocolMessage<T>) => void;

    /**
     * send message w/ return
     *
     * @param msg message to post
     */
    send?: <T = any>(msg: ProtocolMessage<T>) => Promise<ProtocolMessage>;
}

/**
 * message body of `hello`.
 */
export interface MessageHello {
    /**
     * edge index
     */
    i: number;
    /**
     * node id
     */
    id: string;
    /**
     * cluster name joined.
     */
    cluster: string;
    /**
     * extended properties.
     */
    [key: string]: string | number;
}

/**
 * request payload
 */
export interface MessageRequest<T = any> {
    /**
     * task-id (is not request-id)
     */
    id?: string;
    /**
     * parameters..
     */
    param?: { [key: string]: string | number | string[] | number[] };
    /**
     * payload if exist.
     */
    data?: T;
    /**
     * (optional) flag of asynchronous request.
     * - should queue this request, and finish in later.
     */
    async?: boolean;
}

/**
 * general message handler per message
 */
export interface MessageHandler<T = any, U = ProtocolChannel, Return = void> {
    (msg: T, $ws?: U): Return;
}

/**
 * protocol handler to process the raw protocol.
 */
export interface ProtocolHandler {
    /**
     * handle message.
     * @param msg message from source channel.
     * @param $ws source channel sent message.
     */
    onMessage<T = any>(msg: ProtocolMessage<T>, $ws?: ProtocolChannel): void;

    /**
     * handle for `hello` message.
     */
    onHello?: MessageHandler<MessageHello>;

    /**
     * handle for `request` message. send pack response.
     * @param $req  request-data.
     */
    onRequest?: ($req: MessageRequest) => Promise<any>;

    /**
     * generic message handler.
     * @param type  protocol-type
     * @param data  payload data
     * @param $msg  the original message.
     */
    on?(type: ProtocolType, data: any, $msg: ProtocolMessage): void;
}

/**
 * abstract implementation of client
 */
export abstract class ProtocolClient implements ProtocolHandler, ProtocolChannel {
    public constructor() {}

    /**
     * saved id.
     */
    protected _id = '';

    /**
     * get instance id.
     */
    public abstract id = (id?: string) => (id ? (this._id = id) : this._id);

    /**
     * waiter for receiving message.
     */
    protected awaited: (...a: any) => void = null;

    /**
     * MUST implemenet this.
     */
    public abstract post: <T = any>(msg: ProtocolMessage<T>) => void;

    /**
     * internal stack for async request.
     */
    public readonly $stack = new Stack<ProtocolMessage>();

    /**
     * send and wait response. (max 5sec)
     * @param $msg  message to send.
     */
    public send = async <T = any, U = any>($msg: ProtocolMessage<T>): Promise<ProtocolMessage<U>> => {
        if (!$msg?.type) throw new Error(`.type (string) is required!`);
        // const _err = console.info;
        const type = $msg.type;
        this.post($msg);
        return new Promise((resolve, reject) => {
            this.awaited = (a: any) => {
                try {
                    resolve(a);
                } catch (e) {
                    _err(NS, '! err@resolve =', e);
                    reject(e);
                }
            };
            setTimeout(() => {
                this.awaited && reject(new Error(`404 NOT FOUND - @send[${type || ''}]`));
                this.awaited = null;
            }, 5000);
        });
    };

    /**
     * receiving message...
     * @param $msg  a message from server.
     */
    public onMessage<T = any>($msg: ProtocolMessage<T>): void {
        const { type, data } = $msg;
        _log(NS, `onMessage(${type})`);
        // data && _log(NS, `> data[${type}] =`, $U.json(data));

        // STEP.1 resolve the awaited request. (but, ignore `broadcast` message)
        if (type && this.awaited) {
            const fx = this.awaited;
            this.awaited = null;
            return fx($msg?.data);
        }

        // STEP.2 handle `request` in prior if exist of `onRequest`
        if (type === 'request' && typeof (this as any)['onRequest'] === 'function') {
            // STEP.2-1 find the target handler
            const method: RequestHandler = (this as any)['onRequest'];
            // FINAL. call the processing handler.
            return this.doRequest($msg, method);
        }

        // STEP.3 decode the target function.
        const name = `${type || 'broadcast'}`;
        const target = `on${name.charAt(0).toUpperCase()}${name.substring(1)}`; // must be like `onBroadcast`
        const method: MessageHandler = (this as any)[target];
        if (typeof method === 'function') return method(data);

        // STEP.4 or find the commaon 'on'...
        const $on = (this as any)['on'];
        if (typeof $on === 'function') return $on(type, data);

        // FINAL. ignore this message.
        data && _inf(NS, `> data[${type}].ignored =`, $U.json(data));
        return;
    }

    /**
     * on `hello`.
     * - grant the connection of node.
     */
    public onHello: MessageHandler<MessageHello> = (msg): void => {
        // STEP.1 save the infor
        const { i, id, cluster } = msg;
        _inf(NS, `! node[${id || ''}] has joined to cluster[${cluster || ''}] by edge[${i || 0}].`);
        this.id(id); //! save for reusing.

        // STEP.2 report the node's status...
        Promise.all([checkNetworks().then(L => L[0]), checkPackage()]).then(([net, mod]) => {
            const msg = prepareProtocol<any>('hello', { meta: $U.json({ net, mod }) });
            this.post(msg);
        });
    };

    /**
     * processing `request` protocol.
     * - support `asynchronous` request w/ stack.
     *
     * @param $req      the request
     * @param target    the target method like `onRequest()`
     */
    public doRequest = ($req: ProtocolMessage<MessageRequest>, target: RequestHandler): void => {
        // STEP.0 validate parameters..
        if (!$req) throw new Error(`@req (request-message) is required!`);
        if (!target) throw new Error(`@target (request-handler) is required!`);
        _log(NS, `doRequest(${$req?.id || ''})`);

        // STEP.1 if in async mode, then use stack.
        const $msg = $req.data;
        if ($msg?.async === true) {
            _log(NS, `> async-request[${$req?.id}] =`, $U.json($msg));
            if (this.$stack.push($req) === 1) runWorker(this, target);
            return;
        }

        // STEP.2 run the normal request.
        runReqTarget(this, $req, target);
    };
}
