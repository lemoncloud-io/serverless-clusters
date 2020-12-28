/**
 * `cluster-service.spec.ts`
 * - common service for `cluster-service`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 * @date        2020-12-11 refactoring cluster models
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
//! override environment with `env/<profile>.yml`
import { loadProfile } from 'lemon-core/dist/environ';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect2, _it, GETERR, $U, $engine, GETERR$ } from 'lemon-core';
import { checkValue, ClusterService, extractVals } from './cluster-service';
import * as $tools from '../lib/tools';

/**
 * for internal test
 */
class MyClusterService extends ClusterService {
    public constructor(table?: string) {
        super(table);
    }
    /**
     * dummy unique-id generator...
     */
    private _id = 202000;
    protected $uuid = () => `uuid-${this._id++}`;
}

//! create service instance.
export const instance = (type = 'dummy', current?: number) => {
    const service = new MyClusterService(type == 'dummy' ? 'dummy-data.yml' : '');
    current = current || $U.current_time_ms();
    service.setCurrent(current); //! override current timestamp.
    return { service, current };
};

//! main test body.
describe('ClusterService', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE=', PROFILE);

    //! check environment
    it('should pass environmnet test', async done => {
        const { service } = instance('dummy');
        /* eslint-disable prettier/prettier */
        expect2(service.hello()).toEqual('cluster-service:TT/dummy-data.yml');
        expect2(() => $U.env('STAGE', '')).toEqual('test');
        const expected = 1 ? '' : 'http://localhost:8081';  // it must be '' if defined as '' in `env/none.yml`.
        expect2(() => $U.env('BACKBONE_API', 'http://localhost:8081')).toEqual(expected);
        expect2(() => $engine.environ('BACKBONE_API', 'http://localhost:8081')).toEqual(expected);
        /* eslint-enable prettier/prettier */
        done();
    });

    //! managing cluster
    it('should pass cluster-manager', async done => {
        const { service } = instance('dummy');

        //! check id policy.
        expect2(await service.$edge.storage.nextId()).toEqual(1000001);
        expect2(await service.$edge.nextIdx()).toEqual(1000002);
        expect2(() => service.$edge.asEdgeId(0)).toEqual(`E0`);

        expect2(await service.$node.nextId()).toEqual('uuid-202000');
        expect2(await service.$node.nextId()).toEqual('uuid-202001');

        expect2(() => service.asClusterId('a')).toEqual('a');
        expect2(() => service.asClusterId('a', 'c')).toEqual('a.c');

        expect2(() => checkValue('', 'stereo')).toEqual('@stereo (string) is required');
        expect2(() => checkValue('X', 'stereo')).toEqual('@stereo[X] is not in valid format!');
        expect2(() => checkValue('ab-01', 'stereo')).toEqual(true);

        expect2(() => extractVals({ id: 'a' }, 'id,nick,name'.split(','))).toEqual({});
        expect2(() => extractVals({ id: 'a', nick: 'b' }, 'id,nick,name'.split(','))).toEqual({ nick: 'b' });

        const connectionId = 'Wks_-eeMIE0CIjg=';
        const connId = '5a4b3ff9e78c204d022238';
        expect2(() => $tools.parseBase64(connectionId)).toEqual(connId);

        //! check prepareClusterGroup()
        if (1) {
            const cluster = 'bot';
            const stereo = 'mon';
            const masterId = service.asClusterId(cluster);
            const clusterId = service.asClusterId(cluster, stereo);

            expect2(() => ({ masterId, clusterId })).toEqual({ masterId: 'bot', clusterId: 'bot.mon' });

            /* eslint-disable prettier/prettier */
            expect2(await service.prepareClusterGroup('', '').catch(GETERR)).toEqual('@cluster (string) is required');
            expect2(await service.prepareClusterGroup('.', '').catch(GETERR)).toEqual('@cluster[.] is not in valid format!');
            expect2(await service.prepareClusterGroup(cluster, '').catch(GETERR)).toEqual('@stereo (string) is required');
            expect2(await service.prepareClusterGroup(cluster, '.').catch(GETERR)).toEqual('@stereo[.] is not in valid format!');

            //! pre-condition..
            expect2(await service.$cluster.retrieve(clusterId).catch(GETERR)).toEqual(`404 NOT FOUND - cluster:${clusterId}`);

            //! do prepareClusterGroup()
            const $ret1 = await service.prepareClusterGroup(cluster, stereo);
            expect2(() => $ret1, 'cluster,stereo,clusterId').toEqual({ cluster, stereo, clusterId });

            const $master = await service.$cluster.retrieve(`${cluster}`);
            expect2(() => $master, 'id,type,stereo,cluster,nodes').toEqual({ id:`${cluster}`, type:'cluster', stereo:'master' });

            const $cluster = await service.$cluster.retrieve(clusterId);
            expect2(() => $cluster, 'id,type,stereo,cluster,nodes').toEqual({ id:clusterId, type:'cluster', stereo, cluster, nodes:[] });

            expect2(() => $ret1.Master).toEqual({ ...$master });
            expect2(() => $ret1.Cluster).toEqual({ ...$cluster });
            /* eslint-enable prettier/prettier */
        }

        //! check prepareClusterNode()
        if (1) {
            const cluster = '.';
            const stereo = 'monitor';
            const idx = 1000003;
            const edgeId = `E${1000003}`;
            const nodeId = 'uuid-202002';
            const stage = 'dev';
            const domain = '3sl8rd01c3.execute-api.ap-northeast-2.amazonaws.com';
            const connected = 1;
            const $info = { name: 'dummy-info', connected: 1, stage, domain, connectionId };

            //! pre-condition..
            expect2(await service.$edge.retrieve(edgeId).catch(GETERR)).toEqual(`404 NOT FOUND - edge:${edgeId}`);

            //! do prepareClusterNode()
            const $ret1 = await service.prepareClusterNode(cluster, stereo, '', $info);
            expect2(() => $ret1, 'idx,connId,nodeId,edgeId').toEqual({ idx, connId, nodeId, edgeId });

            const $edge = await service.$edge.retrieve(edgeId).catch(GETERR$);
            expect2(() => $ret1.Edge).toEqual({ ...$edge });
            expect2(() => $edge, 'stereo,cluster,idx,nodeId').toEqual({ stereo, cluster, idx, nodeId });

            const $node = await service.$node.retrieve(nodeId).catch(GETERR$);
            expect2(() => $ret1.Node).toEqual({ ...$node });
            expect2(() => $node, 'stereo,cluster,idx,nodeId,connId').toEqual({ stereo, idx, connId });

            const $conn = await service.$connection.retrieve(connId).catch(GETERR$);
            expect2(() => $ret1.Connection).toEqual({ ...$conn });
            expect2(() => $conn, 'stereo,cluster,idx,nodeId,connId').toEqual({ stereo, nodeId });

            /* eslint-disable prettier/prettier */
            expect2(() => $edge, 'stage,domain,connectionId,connected').toEqual({ stage, domain, connectionId });
            expect2(() => $node, 'stage,domain,connectionId,connected').toEqual({ stage, domain, connectionId, connected });
            expect2(() => $conn, 'stage,domain,connectionId,connected').toEqual({ stage, domain, connectionId, connected });
            /* eslint-enable prettier/prettier */

            //! check updated info....
            /* eslint-disable prettier/prettier */
            const $ret2 = await service.prepareClusterNode(cluster, stereo, nodeId, { ...$info, domain: '2', connected: 0, stage: '!' });
            expect2(() => $ret2, 'idx,connId,nodeId,edgeId').toEqual({ idx, connId, nodeId, edgeId });
            expect2(() => $ret2.Edge, 'stage,domain,connectionId,connected').toEqual({ stage: '!', domain: '2', connectionId });
            expect2(() => $ret2.Node, 'stage,domain,connectionId,connected').toEqual({ stage: '!', domain: '2', connectionId, connected: 0 });
            expect2(() => $ret2.Connection, 'stage,domain,connectionId,connected').toEqual({ stage: '!', domain: '2', connectionId, connected: 0 });
            /* eslint-enable prettier/prettier */
        }

        //! check updateConnectState()
        if (1) {
            const cluster = '.';
            const stereo = 'monitor';
            const idx = 1000003;
            const edgeId = `E${1000003}`;
            const nodeId = 'uuid-202002';

            /* eslint-disable prettier/prettier */
            expect2(await service.updateClusterNode({}).catch(GETERR)).toEqual('.connectionId is required!');

            //! pre-condition..
            expect2(await service.$node.retrieve(nodeId), 'id,stereo,idx,nodeId,cluster').toEqual({ id: nodeId, stereo, idx, nodeId: undefined, cluster: undefined });
            expect2(await service.$edge.retrieve(edgeId), 'id,stereo,idx,nodeId,cluster').toEqual({ id: edgeId, stereo, idx, nodeId, cluster });
            expect2(await service.$connection.retrieve(connId), 'id,stereo,idx,nodeId,cluster').toEqual({ id: connId, stereo, idx: undefined, nodeId, cluster: undefined });

            expect2(await service.$node.retrieve(nodeId), 'stage,connected,connectedAt').toEqual({ stage: '!', connected: 0, connectedAt: undefined });
            expect2(await service.$edge.retrieve(edgeId), 'stage,connected,connectedAt').toEqual({ stage: '!', connected: undefined, connectedAt: undefined });
            expect2(await service.$connection.retrieve(connId), 'stage,connected,connectedAt').toEqual({ stage: '!', connected: 0, connectedAt: undefined });

            //! change connected := 1
            const $ret1 = await service.updateClusterNode({ connectionId, connected: 1, stage: 'X' }).catch(GETERR$);
            expect2(() => $ret1, 'idx,connId,nodeId,edgeId,cluster,stereo').toEqual({ idx, connId, nodeId, edgeId, cluster, stereo });

            //! post-condition..
            expect2(await service.$node.retrieve(nodeId), 'stage,connected,connectedAt').toEqual({ stage: 'X', connected: 1, connectedAt: undefined });
            expect2(await service.$edge.retrieve(edgeId), 'stage,connected,connectedAt').toEqual({ stage: 'X', connected: 1, connectedAt: undefined });
            expect2(await service.$connection.retrieve(connId), 'stage,connected,connectedAt').toEqual({ stage: 'X', connected: 1, connectedAt: undefined });

            //! update the unknown connection
            const $ret2 = await service.updateClusterNode({ connectionId: 'xxx', connected: 1, stage: 'X' }).catch(GETERR$);
            expect2(() => $ret2, 'idx,connId,nodeId,edgeId,cluster,stereo').toEqual({ idx:0, connId: 'c71c', nodeId:'', edgeId:'', cluster:'', stereo:'' });

            /* eslint-enable prettier/prettier */
        }

        /* eslint-enable prettier/prettier */
        done();
    });
});
