/**
 * `protocol.spec.ts`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect2, _it, loadJsonSync, $U, GETERR, GETERR$, waited } from 'lemon-core';
import {
    checkDiskSpace,
    checkNetworks,
    checkPackage,
    checkUsage,
    extractStat,
    now,
    parseBody,
    parseMessage,
    prepareProtocol,
    prepareRequest,
    prepareResponse,
    ProtocolChannel,
    ProtocolClient,
    ProtocolHandler,
    ProtocolMessage,
    ProtocolType,
} from './protocol';

/**
 * server mocks to simulate protocol
 */
class MyProtocolServer implements ProtocolHandler {
    public readonly clients: ProtocolChannel[] = [];
    public readonly stacks: { [key: string]: ProtocolMessage[] } = {};
    public last = (i: string | number) => this.stacks[`${i}`]?.slice(-1)[0];

    public constructor() {}
    public onMessage<T = any>(msg: ProtocolMessage<T, ProtocolType>, $ws?: ProtocolChannel): void {
        const { type, data } = msg;
        const id = $ws.id();
        const list = this.stacks[id] || [];
        list.push(msg);
        this.stacks[id] = list;
        if (type == '?' && $ws) {
            $ws.post({ type: '!', data: { ...data, id, size: list.length } }); //! echo back to client.
        }
    }

    /**
     * register client, and get channel to server.
     * @param client  client.
     */
    public register = (client: ProtocolClient): ProtocolChannel => {
        // this.clients.push(client);
        const i = this.clients.length;
        //! channel: server --> client.
        const ws2client = new (class implements ProtocolChannel {
            protected wss: ProtocolHandler;
            public constructor(wss: ProtocolHandler, i: number | string) {
                this.wss = wss;
                this.id = () => `${i}`;
            }
            public id = () => '';
            public post = <T = any>(msg: ProtocolMessage<T, ProtocolType>): void =>
                setTimeout(() => this.wss.onMessage(msg, ws2svr), 0) && undefined;
        })(client, i);
        this.clients.push(ws2client);
        //! channel: client --> server.
        const ws2svr = new (class implements ProtocolChannel {
            protected wss: ProtocolHandler;
            public constructor(wss: ProtocolHandler, i: number | string) {
                this.wss = wss;
                this.id = () => `${i}`;
            }
            public id = () => '';
            public post = <T = any>(msg: ProtocolMessage<T, ProtocolType>): void => this.wss.onMessage(msg, ws2client);
        })(this, i);
        //! returns the channel to server.
        return ws2svr;
    };

    public broadcast = (data: any) => {
        const msg = prepareProtocol<any>('', data);
        this.clients.map(C => C.post(msg));
    };
}

/**
 * client mocks to simulate protocol
 */
class MyProtocolClient extends ProtocolClient {
    public readonly $ws: ProtocolChannel;
    public readonly stacks: ProtocolMessage[] = [];
    public id = () => this.$ws.id();
    public last = () => this.stacks.slice(-1)[0];
    public $broadcast: any = null;
    public $on: any = null;

    public constructor(server: MyProtocolServer) {
        super();
        this.$ws = server.register(this);
    }
    public post = <T = any>(msg: ProtocolMessage<T, ProtocolType>) => {
        this.$ws.post(msg);
    };
    public onMessage = <T = any>($msg: ProtocolMessage<T>): void => {
        this.stacks.push($msg);
        return super.onMessage($msg);
    };
    public onBroadcast = (msg: any) => {
        this.$broadcast = msg;
    };
    public on = (type: ProtocolType, data: any) => {
        this.$on = { type, data };
    };
}

//! main test body.
describe('protocol', () => {
    jest.setTimeout(10 * 1000);

    //! basic function.
    it('should pass protocol spec', async done => {
        //! test now()
        expect2(() => now() > 0).toEqual(true);
        expect2(() => now() >= new Date().getTime()).toEqual(true);

        const ts = now();
        expect2(() => now(ts)).toEqual(ts); //! override `ts`
        expect2(() => now()).toEqual(ts); //! get the saved one.
        expect2(() => now() > new Date().getTime()).toEqual(false);

        /* eslint-disable prettier/prettier */
        //! test prepareProtocol()
        expect2(() => prepareProtocol('hello', null)).toEqual({ type: 'hello', data: null, ts });
        expect2(() => prepareProtocol('hello', null).ts > 0).toEqual(true);

        expect2(() => prepareRequest('')).toEqual('@id (string) is required!');
        expect2(() => prepareRequest(' ')).toEqual('@id (string) is required!');
        expect2(() => prepareRequest(1 as any)).toEqual({ id: '1', type: 'request', ts });

        expect2(() => prepareResponse(null as any)).toEqual('@req (request-model) is required!');
        expect2(() => prepareResponse({ } as any)).toEqual('.id (string) is required!');
        expect2(() => prepareResponse({ id: 'x', type: 'request' })).toEqual({ id: 'x', type: 'response', ts });

        //! test parseBody()
        expect2(() => parseBody('')).toEqual({ body: '' });
        expect2(() => parseBody('!')).toEqual({ body: '!' });
        expect2(() => parseBody('{}')).toEqual({});
        expect2(() => parseBody('{.}')).toEqual({ body: '{.}', error: 'Unexpected token . in JSON at position 1' });

        expect2(() => parseBody('', 'data')).toEqual({ data: '' });
        expect2(() => parseBody('!', 'data')).toEqual({ data: '!' });
        expect2(() => parseBody('{}', 'data')).toEqual({});
        expect2(() => parseBody('{.}', 'data')).toEqual({ data: '{.}', error: 'Unexpected token . in JSON at position 1' });

        //! test parseMessage()
        expect2(() => parseMessage('')).toEqual({ type: '' });
        expect2(() => parseMessage('!')).toEqual({ type: '!' });
        expect2(() => parseMessage('{}')).toEqual({ type: '' });
        expect2(() => parseMessage('{.}')).toEqual({ type: '', data: '{.}', error: 'Unexpected token . in JSON at position 1' });

        expect2(() => parseMessage(null)).toEqual({ type: '', data: null });
        expect2(() => parseMessage(undefined)).toEqual({ type: '', data: undefined });
        expect2(() => parseMessage(0)).toEqual({ type: '', data: 0 });
        expect2(() => parseMessage({ x:2 })).toEqual({ type: '', data: { x: 2 } });
        expect2(() => parseMessage('{"!":"hi"}')).toEqual({ type: 'hi', '!': 'hi' });
        expect2(() => parseMessage('{"type":"hi"}')).toEqual({ type: 'hi' });
        expect2(() => parseMessage($U.json({ id:1, type:'', data:{}, ts: 0 }))).toEqual({ id:1, type:'', data:{}, ts: 0 });

        //! test extractStat();
        expect2(() => extractStat({})).toEqual({});
        expect2(() => extractStat({ a: 1, b: null })).toEqual({ a: 1, b: null });
        expect2(() => extractStat({ a: [], b: undefined })).toEqual({});

        /* eslint-enable prettier/prettier */
        done();
    });

    //! test checkUsage()
    it('should pass check system', async done => {
        const $pack = loadJsonSync('package.json');

        //! checkDiskSpace()
        expect2(
            await checkDiskSpace()
                .then(_ => _.total > 0 && _.total > _.free && _.free > 0 && _.used > 0 && _.status === 'READY')
                .catch(e => (GETERR(e) == $U.json({ code: 'MODULE_NOT_FOUND' }) ? true : e)),
        ).toEqual(true);

        //! checkUsage()
        expect2(
            await checkUsage()
                .catch(GETERR)
                .then((N: any) => N.cpu >= 0 && N.disk >= 0 && N.ram >= 0),
        ).toEqual(true);

        /* eslint-disable prettier/prettier */
        expect2(await checkNetworks().then(_ => _[0]).then(I => I.addr && I.mac && I.name && true)).toEqual(true)
        expect2(await checkPackage(), '!modified').toEqual({ name: $pack.name, version: $pack.version, core: '2.2.15', stage: 'local' })

        /* eslint-enable prettier/prettier */
        done();
    });

    //! test protocol()
    it('should pass protocol', async done => {
        const svr = new MyProtocolServer();
        const ws0 = new MyProtocolClient(svr);
        const ws1 = new MyProtocolClient(svr);

        //! check id
        expect2(() => ws0.id()).toEqual('0');
        expect2(() => ws1.id()).toEqual('1');
        expect2(() => svr.stacks).toEqual({});

        //! check mssage..
        expect2(() => ws0.post({ type: '!', ts: 2 })).toEqual(undefined);
        expect2(() => svr.stacks).toEqual({ 0: [{ type: '!', ts: 2 }] });
        expect2(() => svr.last(0)).toEqual({ type: '!', ts: 2 });
        expect2(() => ws1.post({ type: '', ts: 3 })).toEqual(undefined);
        expect2(() => svr.stacks).toEqual({ 0: [{ type: '!', ts: 2 }], 1: [{ type: '', ts: 3 }] });
        expect2(() => svr.last(1)).toEqual({ type: '', ts: 3 });

        //! check client's stacks. !WARN - should be asynchronous.
        expect2(() => ws0.stacks).toEqual([]);
        expect2(() => svr.clients[0].post({ type: '!', ts: 5 })).toEqual(undefined);
        expect2(() => ws0.stacks).toEqual([]); //WARN - should be asynchronous.
        expect2(await waited(1)).toEqual(undefined);
        expect2(() => ws0.stacks).toEqual([{ type: '!', ts: 5 }]); //WARN - should be asynchronous.

        //! check client's send() w/ callback.
        expect2(await ws0.send({ type: '' }).catch(GETERR)).toEqual('.type (string) is required!');
        expect2(await ws0.send({ type: '?' }).catch(GETERR$)).toEqual({ ...{ id: '0', size: 2 } });
        // eslint-disable-next-line prettier/prettier
        expect2(await ws0.send({ type: '?', data: { hello: 'world' } }).catch(GETERR$)).toEqual({ ...{ id: '0', size: 3, hello: 'world' } });

        //! check `hello` message.
        const hello0 = { i: 2, id: 'X', cluster: 'C' };
        expect2(() => svr.clients[0].post({ type: 'hello', data: hello0 })).toEqual(undefined);
        expect2(await waited(1)).toEqual(undefined);
        expect2(() => ws0.last()).toEqual({ type: 'hello', data: { ...hello0 } });
        expect2(await waited(1)).toEqual(undefined);
        expect2(() => svr.last(0), 'type').toEqual({ type: 'hello' }); //! send back `hello`
        expect2(() => Object.keys(svr.last(0).data)).toEqual(['meta']); //! must had `.meta`
        expect2(() => Object.keys(JSON.parse(svr.last(0).data.meta))).toEqual(['net', 'mod']); //! meta has { meta: { net, mod } }

        //! check `broadcast` message.
        expect2(() => ws0.$broadcast).toEqual(null);
        expect2(() => ws1.$broadcast).toEqual(null);
        expect2(() => svr.broadcast('haha')).toEqual(undefined);
        expect2(await waited(1)).toEqual(undefined);
        expect2(() => ws0.$broadcast).toEqual('haha');
        expect2(() => ws1.$broadcast).toEqual('haha');

        //! check `on` message handler...
        const msgHoho: any = { type: 'hoho', data: 'world' };
        expect2(() => ws0.$on).toEqual({ type: '!', data: undefined }); //! might be initial msg.
        expect2(() => svr.clients[0].post({ ...msgHoho })).toEqual(undefined);
        expect2(await waited(1)).toEqual(undefined);
        expect2(() => ws0.$on).toEqual({ ...msgHoho });

        /* eslint-enable prettier/prettier */
        done();
    });
});
