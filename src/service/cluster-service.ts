/**
 * `cluster-service.ts`
 * - common service for `clusters`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 * @date        2020-12-11 refactoring cluster models
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from 'lemon-core';
import {
    NUL404,
    AbstractManager,
    CoreModelFilterable,
    Elastic6Service,
    Elastic6QueryService,
    GeneralKeyMaker,
    ProxyStorageService,
    StorageMakeable,
    DynamoStreamNextHandler,
} from 'lemon-core';
import {
    ModelType,
    Model,
    $FIELD,
    ConnectionModel,
    ClusterModel,
    RequestModel,
    ResponseModel,
    EdgeModel,
    NodeModel,
    ConnectionInfo,
    CONSTRAINT,
} from './cluster-model';
import * as $tools from '../lib/tools';
import { parseBase64 } from '../lib/tools';
const NS = $U.NS('CLST', 'blue'); // NAMESPACE TO BE PRINTED.

/**
 * validate value range.
 */
export const checkValue = (val: string, attr: keyof typeof CONSTRAINT): boolean => {
    const re = CONSTRAINT[attr];
    if (re && !val) throw new Error(`@${attr} (string) is required`);
    if (re && !re.test(val)) throw new Error(`@${attr}[${val}] is not in valid format!`);
    return true;
};

/**
 * extract attribute's value only by keys
 * @param $org  the target node
 * @param keys  the filtering key.
 */
export const extractVals = ($org: any, keys: string[], ignores = ['id', 'ns', 'type', 'stereo']) =>
    keys.reduce((M: { [key: string]: string | number }, key) => {
        if (!key || ignores.includes(key)) return M;
        const val = $org[key];
        if (val === null) {
            M[key] = val;
        } else if (val !== undefined && (typeof val === 'string' || typeof val === 'number')) {
            M[key] = val;
        }
        return M;
    }, {});

/**
 * class: `ClusterService`
 * - core services for template.
 */
export class ClusterService extends GeneralKeyMaker<ModelType> implements StorageMakeable<Model, ModelType> {
    public static readonly ENV_TABLE_NAME = 'MY_DYNAMO_TABLE';
    public static readonly DEF_TABLE_NAME = 'MyTableEdge';
    public static readonly AUTO_SEQUENCE = 1000000;

    protected readonly tableName: string;
    protected readonly idName: string;
    protected current: number = 0; // for unit-edge. set the current time-stamp.

    public readonly elastic: Elastic6Service<any>;
    public readonly search: Elastic6QueryService<any>;
    public readonly dstream: DynamoStreamNextHandler;

    //! create typed-model-services.
    public readonly $cluster: MyClusterManager;
    public readonly $edge: MyEdgeManager;
    public readonly $node: MyNodeManager;
    public readonly $connection: MyConnectionManager;
    public readonly $request: MyRequestManager;
    public readonly $response: MyResponseanager;

    /**
     * default constructor
     * @param tableName     target table-name (or .yml dummy file-name)
     * @Param ns            namespace of dataset.
     */
    public constructor(tableName?: string, ns?: string, idName?: string) {
        super(ns || $U.env('NS', 'TT')); // use 'env.NS' as default.
        this.tableName = tableName || $U.env(ClusterService.ENV_TABLE_NAME, ClusterService.DEF_TABLE_NAME);
        this.idName = idName || '_id';
        _log(NS, `ClusterService(${this.tableName || ''}, ${this.NS || ''})...`);

        //! prepare each model-service per type.
        this.$cluster = new MyClusterManager(this);
        this.$edge = new MyEdgeManager(this);
        this.$node = new MyNodeManager(this);
        this.$connection = new MyConnectionManager(this);
        this.$request = new MyRequestManager(this);
        this.$response = new MyResponseanager(this);
    }

    /**
     * say hello()
     */
    public hello = (): string => `cluster-service:${this.NS}/${this.tableName}`;

    /**
     * override current type.
     */
    public setCurrent = (current: number) => (this.current = current);
    public getCurrent = () => this.current || new Date().getTime();

    /**
     * unique-id generator.
     */
    protected $uuid = (): string => $U.uuid();

    /**
     * make next-uuid (unique id).
     */
    public nextUuid = () => this.$uuid();

    /**
     * get internal `_id` by primary keys.
     * @param type  model-type
     * @param id    node-id (or sequence)
     */
    public asKey(type: ModelType, id: string | number): string {
        const $key = this.asKey$(type, `${id || ''}`);
        return $key._id;
    }

    /**
     * convert to `cluster-id`
     * @param cluster   name of cluster
     * @param stereo    stereo as `role`.
     */
    public asClusterId = (cluster: string, stereo?: string) => (stereo ? `${cluster}.${stereo}` : `${cluster}`);

    /**
     * create storage-service w/ fields list.
     * - idName should be `_id`
     */
    public makeStorageService<T extends Model>(type: ModelType, fields: string[], filter: CoreModelFilterable<T>) {
        //! use proxy-storage-service for both dynamo-table and dummy-data.
        const storage = new ProxyStorageService<T, ModelType>(this, this.tableName, fields, filter, this.idName);
        storage.setTimer(() => this.getCurrent()); // use same timer source.
        return storage.makeTypedStorageService(type);
    }

    /**
     * prepare cluster-group set of master, stereo.
     *
     * @param cluster   name of cluster
     * @param stereo    'role' in cluster
     */
    public prepareClusterGroup = async (cluster: string, stereo: string) => {
        cluster = `${cluster || ''}`.trim();
        stereo = `${stereo || ''}`.trim();

        // STEP.0 validate parameters.
        checkValue(cluster, 'cluster');
        checkValue(stereo, 'stereo');

        // STEP.1 prepare master & sub cluster model.
        const masterId = this.asClusterId(cluster);
        const clusterId = this.asClusterId(cluster, stereo);

        // STEP.1-1 speed up by parallel loading.
        // const $master = await this.$cluster.storage.readOrCreate(masterId, { stereo: 'master' });
        // const $cluster = await this.$cluster.storage.readOrCreate(clusterId, { stereo, cluster, nodes: [] });
        const [$master, $cluster] = await Promise.all([
            this.$cluster.storage.readOrCreate(masterId, { stereo: 'master' }),
            this.$cluster.storage.readOrCreate(clusterId, { stereo, cluster, nodes: [] }),
        ]);

        // FINAL. pack as object..
        const Master: ClusterModel = { ...$master };
        const Cluster: ClusterModel = { ...$cluster };

        //! returns..
        return { cluster, stereo, clusterId, Master, Cluster };
    };

    /**
     * prepare cluster-node set of edge, node, and connection.
     *
     * @param cluster   the current cluster name
     * @param stereo    'role' in cluster
     * @param nodeId    (optional) node-id
     * @param $info     the shared connection information.
     * @param $incr     (optional) the incrementals..
     */
    public prepareClusterNode = async <T extends ConnectionInfo>(
        cluster: string,
        stereo: string,
        nodeId: string,
        $info: T,
        $incr?: T,
    ) => {
        stereo = `${stereo || ''}`.trim();
        nodeId = nodeId ? `${nodeId || ''}`.trim() : await this.$node.nextId();

        // STEP.0 validate parameters.
        checkValue(stereo, 'stereo');
        checkValue(nodeId, 'nodeId');
        if (!$info || !$info.connectionId) throw new Error(`.connectionId (string) is required!`);

        // STEP.1 prepare connection...
        const { connectionId, stage, domain } = $info;
        const $core = { connectionId, stage, domain };
        const connId = $tools.parseBase64(connectionId);
        const $conn = await this.$connection.storage.readOrCreate(connId, { stereo }); //! make sure.

        // STEP.1-1 prepare node.....
        const $node = await this.$node.storage.readOrCreate(nodeId, { stereo });

        // STEP.1-2 prepare edge....
        const idx = $U.N($node.idx, 0) || (await this.$edge.nextIdx());
        const edgeId = this.$edge.asEdgeId(idx);
        const $edge = await this.$edge.storage.readOrCreate(edgeId, { stereo });

        // STEP.2 update each models....
        const $conn2: ConnectionModel = extractVals($info, $FIELD.connection);
        const $node2: NodeModel = extractVals($info, $FIELD.node);
        const $edge2: EdgeModel = { ...$core };

        // STEP.2-1 update each.
        const $conn3 = await this.$connection.storage.update(connId, { ...$conn2, stereo, nodeId }, { ...$incr });
        _log(NS, `> conn[${connId}].saved =`, $U.json($conn3));
        const $node3 = await this.$node.storage.update(nodeId, { ...$node2, stereo, connId, idx }, { ...$incr });
        _log(NS, `> node[${nodeId}].saved =`, $U.json($node3));
        // eslint-disable-next-line prettier/prettier
        const $edge3 = await this.$edge.storage.update(edgeId, { ...$edge2, stereo, cluster, nodeId, idx }, { ...$incr });
        _log(NS, `> edge[${edgeId}].saved =`, $U.json($edge3));

        // FINAL. pack as object.
        const Connection: ConnectionModel = { ...$conn, ...$conn3 };
        const Node: NodeModel = { ...$node, ...$node3 };
        const Edge: EdgeModel = { ...$edge, ...$edge3 };

        //! returns..
        return { idx, connId, nodeId, edgeId, cluster, stereo, Node, Edge, Connection };
    };

    /**
     * update the connection state from infor
     *
     * @param $info  connection-info
     * @param $incr  (optional) incrementals
     */
    public updateClusterNode = async <T extends ConnectionInfo>($info: T, $incr?: T) => {
        const { connectionId } = $info;
        _log(NS, `updateConnectState(${connectionId})`);
        if (!connectionId) throw new Error(`.connectionId is required!`);

        // STEP.1 extract the each updates....
        const $conn1: ConnectionModel = extractVals($info, $FIELD.connection);
        const $node1: NodeModel = extractVals($info, $FIELD.node);
        const $edge1: EdgeModel = extractVals($info, $FIELD.edge);

        // STEP.1 update connection models..
        const connId = parseBase64(connectionId);
        const $conn: ConnectionModel = await this.$connection.retrieve(connId).catch(NUL404);
        // eslint-disable-next-line prettier/prettier
        const $conn2 = $conn ? await this.$connection.storage.storage.update($conn._id, { ...$conn1 }, { ...$incr }) : null;
        $conn2 && _log(NS, `> connection[${connId}].saved =`, $U.json($conn2));

        // STEP.2 cleanup the linked node....
        const nodeId = $conn ? `${$conn.nodeId || ''}` : '';
        const $node: NodeModel = nodeId ? await this.$node.retrieve(nodeId).catch(NUL404) : null;
        const $node2 = $node ? await this.$node.storage.storage.update($node._id, { ...$node1 }, { ...$incr }) : null;
        $node2 && _log(NS, `> node[${nodeId}].saved =`, $U.json($node2));

        // STEP.3 update the edge..
        const idx = $node ? $node.idx : 0;
        const edgeId = idx ? this.$edge.asEdgeId(idx) : '';
        const $edge: EdgeModel = edgeId ? await this.$edge.retrieve(edgeId).catch(NUL404) : null;
        const $edge2 = $edge ? await this.$edge.storage.storage.update($edge._id, { ...$edge1 }, { ...$incr }) : null;
        $edge2 && _log(NS, `> edge[${edgeId}].saved =`, $U.json($edge2));

        // STEP.4 information about cluster.
        const cluster = `${$edge?.cluster || ''}`;
        const stereo = `${$edge?.stereo || ''}`;

        // FINAL. returns void.
        const Connection: ConnectionModel = { ...$conn, ...$conn2 };
        const Node: NodeModel = { ...$node, ...$node2 };
        const Edge: EdgeModel = { ...$edge, ...$edge2 };

        //! returns..
        return { idx, connId, nodeId, edgeId, cluster, stereo, Node, Edge, Connection };
    };
}

/**
 * class: `MyCoreManager`
 * - shared core manager for all model.
 * - handle 'name' like unique value in same type.
 */
export class MyCoreManager<T extends Model> extends AbstractManager<T, ClusterService, ModelType> {
    protected constructor(type: ModelType, parent: ClusterService, uniqueField?: string, fields?: string[]) {
        super(type, parent, fields || $FIELD[type], uniqueField);
    }
    public hello = () => `${this.storage.hello()}`;

    /**
     * prepare default-model when creation
     * @param $def  base-model
     */
    protected prepareDefault($def: T): T {
        return { last: 0, ...$def };
    }

    // override `super.onBeforeSave()`
    public onBeforeSave(model: T, origin: T): T {
        //NOTE! - not possible to change name in here.
        if (origin && origin.name) delete model.name;
        return model;
    }
}

/**
 * class: `MyClusterManager`
 * - manager for cluster-model.
 */
class MyClusterManager extends MyCoreManager<ClusterModel> {
    public constructor(parent: ClusterService) {
        super('cluster', parent);
    }
}

/**
 * class: `MyNodeManager`
 * - manager for cluster-model.
 */
class MyNodeManager extends MyCoreManager<NodeModel> {
    public constructor(parent: ClusterService) {
        super('node', parent);
    }

    /**
     * get the next node-id in unique.
     */
    public nextId = (): Promise<string> => Promise.resolve(this.parent.nextUuid());
}

/**
 * class: `MyEdgeManager`
 * - manager for edge-model.
 */
class MyEdgeManager extends MyCoreManager<EdgeModel> {
    public constructor(parent: ClusterService) {
        super('edge', parent);
    }

    /**
     * filters before saving model.
     * @param model     the updated model to save
     * @param origin    (optional) the original model
     */
    public onBeforeSave(model: EdgeModel, origin?: EdgeModel): EdgeModel {
        //! call super
        model = super.onBeforeSave(model, origin);

        //! finally, return.
        return model;
    }

    /**
     * make the next idx in unique.
     */
    public nextIdx = (): Promise<number> => this.storage.nextId();

    /**
     * convert idx to edge-id
     */
    public asEdgeId = (idx: number) => `${idx < 0 ? 'N' : 'E'}${idx < 0 ? -1 * idx : idx}`;
}

/**
 * class: `MyConnectionManager`
 * - manager for connection-model.
 */
class MyConnectionManager extends MyCoreManager<ConnectionModel> {
    public constructor(parent: ClusterService) {
        super('connection', parent);
    }
}

/**
 * class: `MyRequestManager`
 * - manager for request-model.
 */
class MyRequestManager extends MyCoreManager<RequestModel> {
    public constructor(parent: ClusterService) {
        super('request', parent);
    }
}

/**
 * class: `MyResponseanager`
 * - manager for response-model.
 */
class MyResponseanager extends MyCoreManager<ResponseModel> {
    public constructor(parent: ClusterService) {
        super('response', parent);
    }
}

/**
 * class: `ClusterServiceMain`
 * - default main class
 */
export class ClusterServiceMain extends ClusterService {
    public constructor() {
        super();
    }
}

//! export as default
export default new ClusterServiceMain();
