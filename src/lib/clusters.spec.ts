/**
 * `clusters.spec.ts`
 * - common service for `clusters-service`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
//! override environment with `env/<profile>.yml`
import { loadProfile } from 'lemon-core/dist/environ';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect2, _it, GETERR, NextContext, $U, GETERR$ } from 'lemon-core';
import { Clusters, ClusterEvent } from './clusters';
import { ClusterService } from '../service/cluster-service';
import { $base64, convertDDSEvent, parseBase64 } from './tools';
import * as $tools from './tools.spec';
import * as $service from '../service/cluster-service.spec';

/**
 * for internal testing.
 */
class MyClustersDummy extends Clusters {
    /**
     * default constructor()
     */
    public constructor(service: ClusterService, event: ClusterEvent, context: NextContext) {
        super(service, event, context);
    }
    public readonly $posted: any[] = [];
    public postMessage = async (endpoint: string, connectionId: string, payload: any): Promise<void> => {
        const data = { endpoint, connectionId, payload };
        this.$posted.push(data);
        return;
    };
}

//! create service instance.
export const instance = (type?: string) => {
    const { $evt, event, ld } = $tools.instance(type);
    const { service: $svc, current } = $service.instance();
    const $me = new MyClustersDummy($svc, $evt, null);
    return { $svc, $me, $evt, event, ld, current };
};

//! main test body.
describe('Clusters', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE=', PROFILE);

    //! check environment
    it('should pass basic test', async done => {
        const { $me, $svc, $evt } = instance('wss-con-event');

        //! pre-condition..
        const type = 'CONNECT';
        const connectionId = 'WklOAfLioE0CJPw=';
        const domain = '3sl8rd01c3.execute-api.ap-northeast-2.amazonaws.com';
        const stage = `dev`;
        const endpoint = `https://${domain}/${stage}`;

        expect2(() => $evt, 'type,connectionId,endpoint').toEqual({ type, connectionId, endpoint: undefined });
        expect2(() => $evt, 'stage,connectionId,domain').toEqual({ stage, connectionId, domain });

        expect2(() => $svc.hello()).toEqual('cluster-service:TT/dummy-data.yml');
        expect2(() => $me.hello()).toEqual(`clusters:${type}:${connectionId}:cluster-service:TT/dummy-data.yml`);
        expect2(() => $me.default()).toEqual({ cluster: 'open', stereo: 'none' });

        expect2(() => $me.$posted[0]).toEqual(undefined);
        expect2(await $me.postMessage('a', 'b', 'c').catch(GETERR)).toEqual(undefined);
        expect2(() => $me.$posted[0]).toEqual({ endpoint: 'a', connectionId: 'b', payload: 'c' });

        expect2(() => $me.$posted[1]).toEqual(undefined);
        expect2(await $me.postClientMessage('x').catch(GETERR)).toEqual(undefined);
        expect2(() => $me.$posted[1]).toEqual({ endpoint, connectionId, payload: 'x' });

        expect2(() => $me.$posted[2]).toEqual(undefined);
        expect2(await $me.postClientMessage('x', {}).catch(GETERR)).toEqual('@domain (string) is required!');
        expect2(() => $me.$posted[2]).toEqual(undefined);

        /* eslint-disable prettier/prettier */
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test onConnection().
    it('should pass onConnection()', async done => {
        const { $me, $evt, $svc, current } = instance('wss-con2-event.json');
        /* eslint-disable prettier/prettier */

        expect2(() => $svc.getCurrent()).toEqual(current);

        //! test authorization.
        expect2(await $me.onAuthorize('').catch(GETERR)).toEqual('@authorization is required!');
        expect2(await $me.onAuthorize('Basic aGVsbzpsZW1vbg==').catch(GETERR)).toEqual('@stereo[helo] (string) is invalid - check env:AUTH_HELO_PASS');
        expect2(await $me.onAuthorize('Basic bW9uaXRvcjpsZW1vbg==').catch(GETERR)).toEqual('@stereo[monitor] (string) is invalid - check env:AUTH_MONITOR_PASS');

        expect2(await $me.onAuthorize('Basic ' + $base64.encode('hi:world')).catch(GETERR)).toEqual('@stereo[hi] (string) is invalid - check env:AUTH_HI_PASS');
        expect2(await $me.onAuthorize('Basic ' + $base64.encode('none:a:c:e')).catch(GETERR)).toEqual('@pass[a:c:e] (string) is invalid - stereo:none');
        expect2(await $me.onAuthorize('Basic ' + $base64.encode(' none : hi ')).catch(GETERR)).toEqual('@pass[hi] (string) is invalid - stereo:none');
        expect2(await $me.onAuthorize('Basic ' + $base64.encode(' : hi ')).catch(GETERR)).toEqual('@stereo is required - auth-msg: : hi !');
        expect2(await $me.onAuthorize('Bearer ' + $base64.encode(' h : hi ')).catch(GETERR)).toEqual('@authorization[Bearer IGggOiBoaSA=] is invalid!');

        //! auth by default { cluster, stereo }
        const { stereo, cluster } = $me.default();
        expect2(await $me.onAuthorize('Basic ' + $base64.encode(`${stereo}:lemon`)).catch(GETERR)).toEqual({ id:'', stereo, cluster });
        expect2(await $me.onAuthorize('Basic ' + $base64.encode(`${stereo}/1:lemon`)).catch(GETERR)).toEqual({ id:'1', stereo, cluster });
        expect2(await $me.onAuthorize('Basic ' + $base64.encode(`${stereo}/1/2:lemon`)).catch(GETERR)).toEqual('@stereo[1] (string) is invalid - check env:AUTH_1_PASS');
        expect2(await $me.onAuthorize('Basic ' + $base64.encode(`${cluster}/${stereo}/2:lemon`)).catch(GETERR)).toEqual({ id:'2', stereo, cluster });

        //! check onConnection().
        expect2(await $me.onConnection({ ...$evt, authorization: '' }).catch(GETERR)).toEqual('@authorization is required!');

        if (1) {
            const $ret0 = await $me.onConnection().catch(GETERR$);
            expect2(() => $ret0, 'error').toEqual({ error: '@stereo[helo] (string) is invalid - check env:AUTH_HELO_PASS' });

            const id = '';
            const authorization = 'Basic ' + $base64.encode(`${stereo}${id ? '/' : ''}${id}:lemon`);
            const clusterId = `${cluster}.${stereo}`;
            const connId = $base64.urlDecode($evt.connectionId);

            //! create 1st node..
            const $ret1 = await $me.onConnection({ ...$evt, authorization }).catch(GETERR$);
            expect2(() => $ret1, 'error').toEqual({ error: undefined });
            expect2(() => $ret1, 'id,stereo,cluster,nodeId,connId').toEqual({ id, stereo, cluster, nodeId: 'uuid-202000', connId });
            expect2(() => $ret1, 'nodes').toEqual({ nodes: [] });

            //! validate cluster..
            expect2(await $svc.$cluster.retrieve(clusterId), 'id,type,stereo').toEqual({ id: clusterId, type: 'cluster', stereo });
            expect2(await $svc.$connection.retrieve(connId), 'id,type,stereo').toEqual({ id: connId, type: 'connection', stereo });
            expect2(await $svc.$node.retrieve($ret1.nodeId), 'id,type,stereo').toEqual({ id: 'uuid-202000', type: 'node', stereo });
            expect2(await $svc.$edge.retrieve($ret1.edgeId), 'id,type,stereo').toEqual({ id: 'E1000001', type: 'edge', stereo });

            //! create 2nd node..
            const $ret2 = await $me.onConnection({ ...$evt, authorization }).catch(GETERR$);
            expect2(() => $ret2, 'error').toEqual({ error: undefined });
            expect2(() => $ret2, 'id,stereo,cluster,nodeId,connId').toEqual({ id, stereo, cluster, nodeId: 'uuid-202001', connId });
            expect2(() => $ret2, 'nodes').toEqual({ nodes: [] }); //NOTE - in dummy mode, not support `increment(array)`

            //! validate cluster..
            expect2(await $svc.$cluster.retrieve(clusterId), 'id,type,stereo').toEqual({ id: clusterId, type: 'cluster', stereo });
            expect2(await $svc.$connection.retrieve(connId), 'id,type,stereo').toEqual({ id: connId, type: 'connection', stereo });
            expect2(await $svc.$node.retrieve($ret2.nodeId), 'id,type,stereo').toEqual({ id: 'uuid-202001', type: 'node', stereo });
            expect2(await $svc.$edge.retrieve($ret2.edgeId), 'id,type,stereo').toEqual({ id: 'E1000002', type: 'edge', stereo });
        }

        //! check onDisconnected().
        expect2(await $me.onDisconnected({ ...$evt, connectionId: '' }).catch(GETERR)).toEqual(undefined);

        if (1) {
            const connId = $base64.urlDecode($evt.connectionId);
            const connectedAt = $evt.connectedAt || current;

            //! pre-condition..
            expect2(await $svc.$connection.retrieve(connId), 'stereo,connected,reason,connectedAt').toEqual({ stereo, connected: 2, reason: '', connectedAt });

            //! run onDisconnected() - 1st try
            const $ret1 = await $me.onDisconnected({ ...$evt, reason: 'test' }).catch(GETERR$);
            expect2(() => $ret1?.Connection, 'stereo,connected,reason,connectedAt').toEqual({ stereo, connected: 1, reason: 'test', connectedAt });

            //! post-condtion.
            expect2(await $svc.$connection.retrieve(connId), 'stereo,connected,reason,connectedAt').toEqual({ stereo, connected: 1, reason: 'test', connectedAt });

            //! run onDisconnected() - 2nd try
            const $ret2 = await $me.onDisconnected({ ...$evt, reason: undefined }).catch(GETERR$);
            expect2(() => $ret2?.Connection, 'stereo,connected,reason,connectedAt').toEqual({ stereo, connected: 0, reason: 'unknown', connectedAt });

            //! post-condtion.
            expect2(await $svc.$connection.retrieve(connId), 'stereo,connected,reason,connectedAt').toEqual({ stereo, connected: 0, reason: 'unknown', connectedAt });
        }


        /* eslint-enable prettier/prettier */
        done();
    });

    //! test onMessage()
    it('should pass onMessage()', async done => {
        const { $svc, $me, $evt } = instance('wss-con2-event.json');

        //! fix the current time stamp.
        const current = $U.current_time_ms();
        $svc.setCurrent(current);

        expect2(() => $svc.hello()).toEqual('cluster-service:TT/dummy-data.yml');
        expect2(() => $me.hello()).toEqual('clusters:CONNECT:Wks_-eeMIE0CIjg=:cluster-service:TT/dummy-data.yml');

        const nodeId = 1 ? '' : '1111-2222-3333-4444';
        const connectionId = 'Wks_-eeMIE0CIjg=';
        const cid = '5a4b3ff9e78c204d022238';
        const idx = 1000001;
        const expected = { i: idx, nodeId };
        expect2(() => parseBase64(connectionId)).toEqual(cid);
        expect2(() => $evt.connectionId).toEqual(connectionId);
        expect2(() => $evt.body).toEqual(undefined);
        /* eslint-disable prettier/prettier */

        // //! run main
        // expect2(await $me.run().catch(GETERR)).toEqual({ ...expected });

        // //! check model relationship: ClusterModel & Connection
        // expect2(await $svc.$cluster.retrieve(nodeId), 'createdAt,updatedAt').toEqual({ createdAt:current, updatedAt:current });
        // expect2(await $svc.$cluster.retrieve(nodeId), 'type,stereo,connected,idx').toEqual({ type:'cluster', stereo:'helo', connected:1, idx });
        // expect2(await $svc.$cluster.retrieve(`M${idx}`), 'type,stereo,connectionId,idx,nodeId').toEqual({ type:'cluster', stereo:'map', connectionId, nodeId, idx });
        // expect2(await $svc.$connection.retrieve(cid), 'type,stereo,connectionId,idx,nodeId').toEqual({ type:'connection', stereo:'helo', connectionId, nodeId, idx: undefined });

        //! check post-message
        expect2(await $me.postMessage('', '', null).catch(GETERR)).toEqual(undefined);

        //! check onMessage()
        expect2(await $me.onMessage({ ...$evt, body:'' }, true), 'nodeId,data').toEqual({ nodeId, data: { type: '' } })
        expect2(await $me.onMessage({ ...$evt, body:'{}' }, true), 'nodeId,data').toEqual({ nodeId, data: { type: '' } })
        expect2(await $me.onMessage({ ...$evt, body:'{.}' }, true), 'nodeId,data').toEqual({ nodeId, data: {  data: '{.}', type: '', error: 'Unexpected token . in JSON at position 1' } })

        expect2(await $me.onMessage({ ...$evt, body:'{"stat":{}}' }, true), 'nodeId,data').toEqual({ nodeId, data: { type: '', stat:{} }});
        // expect2(await $me.onMessage({ ...$evt, body:'{"stat":{}}' }, true), '$last,$prev,$diff,$stat').toEqual({ $prev:{} ,$last:{}, $diff:[], $stat:{} });
        // expect2(await $me.onMessage({ ...$evt, body:'{"stat":{"a":1}}' }, true), '$last,$prev,$diff,$stat').toEqual({ $prev:{} ,$last:{ a:1 }, $diff:['a'], $stat:{ a:1 } });
        // expect2(await $me.onMessage({ ...$evt, body:'{"stat":{"b":2}}' }, true), '$last,$prev,$diff,$stat').toEqual({ $prev:{ a:1 } ,$last:{ a:1, b:2 }, $diff:['b'], $stat:{ b:2 } });

        /* eslint-enable prettier/prettier */
        done();
    });

    //! check `$tools`.
    it('should pass dynamo().', async done => {
        const { ld, $me } = instance();
        expect2(() => ld('wss-con-event.json').event.requestContext.eventType).toEqual('CONNECT');

        //! test convertDDSEvent().
        if (1) {
            const ID = '7fda1d59-a88f-47d5-8664-b9d1a748d4f8';
            const event = ld('dds-stream-03.json').event;
            const strm03 = convertDDSEvent(event);
            expect2(() => convertDDSEvent({} as any)).toEqual('.Records[] is required!');
            expect2(() => strm03.nodes.length).toEqual(2);
            expect2(() => strm03.nodes.map(N => N.last.id).join(', ')).toEqual([ID, ID].join(', '));

            //! expected model..
            const expected = {
                _id: 'TT:cluster:7fda1d59-a88f-47d5-8664-b9d1a748d4f8',
                ns: 'TT',
                id: '7fda1d59-a88f-47d5-8664-b9d1a748d4f8',
                type: 'cluster',
                stereo: 'agent',
                connected: 1,
                connectionId: 'W9rRccSAoE0Ab7A=',
                deletedAt: 0,
                domain: '3sl8rd01c3.execute-api.ap-northeast-2.amazonaws.com',
                idx: 1000020,
                last: 0,
                stage: 'dev',
                stat: { cpu: 12, msg: 'ok', state: null as any },
                createdAt: 1606978569258,
                updatedAt: 1606978793643,
            };
            /* eslint-disable prettier/prettier */
            // expect2(await $me.dynamo(event, true).catch(GETERR), 'flattens').toEqual({ flattens: [ expected ] });
            // expect2(await $me.dynamo(event, true).catch(GETERR), 'stats').toEqual({ stats: [{ i: 1000020, stat: expected.stat, stereo: 'agent', connected: 1 }] });
            /* eslint-enable prettier/prettier */
        }

        done();
    });
});
