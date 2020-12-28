/**
 * `hello-api.ts`
 * - common pattern controller for `/hello` w/ nestjs
 * - auto-routed from api-gateway via lambda handler in `serverless.yml`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-12 initial version
 * @date        2019-12-18 support notification event handler.
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import $engine, { _log, _inf, _err, $U } from 'lemon-core';
import {
    GeneralWEBController,
    NextContext,
    NextHandler,
    ProtocolParam,
    ProtocolService,
    GETERR$,
    CallbackParam,
} from 'lemon-core';
// import { $sheets } from '../lib/sheets';
// import { $bots } from '../lib/bots';
const NS = $U.NS('hello', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: `HelloAPIController`.
 * - support both Nest Controller & WebController
 */
class HelloAPIController extends GeneralWEBController {
    /**
     * default constructor()
     */
    public constructor() {
        super('hello');
        _log(NS, `HelloController()...`);
    }

    /**
     * name of this resource.
     */
    public hello = () => `hello-api-controller:${this.type()}`;

    /**
     * say hello (internal purpose)
     *
     * ```sh
     * $ http ':8220/hello/0'
     * $ http PUT ~ => putHello()
     */
    public async getHello(id: string, param: any, body: any, context: NextContext) {
        _log(NS, `getHello(${id})..`);
        _log(NS, `> context =`, $U.json(context));
        const data: any = { hello: `${id}` };

        param = param && Object.keys(param).length > 0 ? param : { a: 'b' };
        body = body && Object.keys(body).length > 0 ? body : { x: 2 };

        if (id == '' || id == '0') {
            return { hello: this.hello() };
        } else if (id == 'protocol') {
            // http ':8220/hello/protocol'
            const service: ProtocolService = $engine.cores.protocol.service;
            // eslint-disable-next-line prettier/prettier
            const protocol: ProtocolParam = service.fromURL(context, 'api://lemon-hello-api/hello/echo', param, body);
            data['protocol'] = protocol;
            data['self'] = service.myProtocolURI(context, 'hello');
        } else if (id == 'execute') {
            // http ':8220/hello/execute'
            // http 'https://9tdk25wjpd.execute-api.ap-northeast-2.amazonaws.com/dev/hello/execute'
            const service: ProtocolService = $engine.cores.protocol.service;
            // eslint-disable-next-line prettier/prettier
            const protocol: ProtocolParam = service.fromURL(context, 'api://lemon-hello-api/hello/echo', param, body);
            protocol.mode = 'POST';
            data['protocol'] = protocol;
            data[id] = await service.execute(protocol).catch(GETERR$);
        } else if (id == 'notify') {
            // http ':8220/hello/notify'
            const service: ProtocolService = $engine.cores.protocol.service;
            // eslint-disable-next-line prettier/prettier
            const protocol: ProtocolParam = service.fromURL(context, 'api://lemon-hello-api/hello/echo', param, body);
            const callback: CallbackParam = { type: 'hello', id: `!${id}` };
            protocol.mode = 'POST';
            data['protocol'] = protocol;
            data[id] = await service.notify(protocol, callback).catch(GETERR$);
        } else if (id == 'enqueue') {
            // http ':8220/hello/enqueue'
            const service: ProtocolService = $engine.cores.protocol.service;
            // eslint-disable-next-line prettier/prettier
            const protocol: ProtocolParam = service.fromURL(context, 'api://lemon-hello-api/hello/echo', param, body);
            const callback: CallbackParam = { type: 'hello', id: `!${id}` };
            protocol.mode = 'POST';
            data['protocol'] = protocol;
            data[id] = await service.enqueue(protocol, callback).catch(GETERR$);
        } else if (id == 'broadcast') {
            // http ':8220/hello/broadcast'
            const service: ProtocolService = $engine.cores.protocol.service;
            // eslint-disable-next-line prettier/prettier
            const protocol: ProtocolParam = service.fromURL(context, 'api://lemon-hello-api/hello/echo', param, body);
            protocol.mode = 'POST';
            data['protocol'] = protocol;
            data[id] = await service.broadcast(context, 'lemon-todaq-out', { x: 2 }).catch(GETERR$);
        }
        return data;
    }

    /**
     * post hello
     *
     * ```sh
     * $ http POST ':8220/hello/0'
     */
    public postHello: NextHandler = async (id, param, body, context) => {
        _log(NS, `postHello(${id})...`);
        _log(NS, `> context =`, $U.json(context));
        return { hello: this.hello(), body };
    };

    /**
     * test event from front app.
     *
     * ```sh
     * $ http ':8220/hello/me/test'
     */
    public async getHelloTest(id: string, param: any, body: any, context: NextContext) {
        _log(NS, `getHelloTest(${id})..`);
        param && _log(NS, `> param[${id}] =`, $U.json(param));
        body && _log(NS, `> body[${id}] =`, $U.json(body));
        context && _log(NS, `> context[${id}] =`, $U.json(context));
        param = param || {};
        //! decode to each cases.
        switch (id) {
            default:
                break;
        }
        //! default.
        return { test: `${id}` };
    }
}

//! create default instance.
export default new HelloAPIController();
