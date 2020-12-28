/**
 * `clusters-model.ts`
 * - definitions of model
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 * @date        2020-12-11 refactoring cluster models
 *
 * Copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $_ } from 'lemon-core';
import { CoreModel } from 'lemon-core';
import { SimpleSet } from '../lib/protocol';

/**
 * type: model-type
 * - use this type to make pkey per data.
 */
export type ModelType = '' | 'cluster' | 'edge' | 'node' | 'connection' | 'request' | 'response';

/**
 * static `monitor` stereo.
 */
export const MONITOR = 'monitor';

/**
 * field constraint to validate
 */
export const CONSTRAINT = {
    cluster: /^[a-z][a-zA-Z0-9\-]{1,}$/,
    stereo: /^[a-z][a-z0-9\-]{1,}$/,
    nodeId: /^[a-z0-9\-]{4,}$/,
};

/**
 * shared common model for connection.
 */
export interface ConnectionInfo {
    /**
     * stage of api-gateway
     */
    stage?: string;
    /**
     * connected domain
     */
    domain?: string;
    /**
     * connection-id
     */
    connectionId?: string;
}

/**
 * class: `Model`
 *  - common model definitions
 *
 * see https://github.com/kimamula/ts-transformer-keys
 *  - keys() 실행 에러 해결을 위해서 `$ npm install --save-dev typescript ttypescript`, 후 tsc -> ttsc로 변경함!.
 */
export interface Model extends CoreModel<ModelType> {
    /**
     * id: model-id
     */
    id?: string;
    /**
     * parent: parent of this model w/ idx
     */
    parent?: string;
    /**
     * stereo: stereo-type in common type.
     */
    stereo?: string;
    /**
     * name: readable name instead of id
     */
    name?: string;
    /**
     * index number within last (used for generating sub-items)
     */
    idx?: number;
    /**
     * last number of index (used for generating sub-items)
     */
    last?: number;
}

/**
 * `cluster`: cluster model
 * - storage for the connected node's `idx`.
 */
export interface ClusterModel extends Model {
    /**
     * stereo type for `role`
     */
    stereo?: string;
    /**
     * registered nodes in this stereo.
     */
    nodes?: number[]; //! list of all node.
    /**
     * cluster in group
     */
    cluster?: string;
}

/**
 * `edge`: mapping idx <-> node-id
 * - storage mapping from `idx` to `nodeId`
 */
export interface EdgeModel extends Model, ConnectionInfo {
    /**
     * as `idx`
     */
    id?: string;
    /**
     * stereo type for `role`
     */
    stereo?: string;
    /**
     * cluster in group
     */
    cluster?: string;
    /**
     * the linked node-id
     */
    nodeId?: string;

    //! the cloned `ConnectionInfo`.
    stage?: string;
    domain?: string;
    connectionId?: string;

    //! from original connection event.
    connected?: number;
    connectedAt?: number;

    /**
     * stat cloned w/ target-node.
     */
    stat?: SimpleSet;

    /**
     * meta cloned only with simple-set
     */
    meta?: SimpleSet;

    /**
     * inner object (readonly)
     */
    readonly Model?: Model;
}

/**
 * `node`: each the connected node
 * - storage per each node connected by `nodeId`
 * - `nodeId` can be distributable to node for re-usage.
 */
export interface NodeModel extends Model, ConnectionInfo {
    /**
     * as `node-id`
     */
    id?: string;
    /**
     * stereo type for `role`
     */
    stereo?: string;
    /**
     * global index-id
     */
    idx?: number;
    /**
     * conn-id to `Connection` model.
     */
    connId?: string;

    //! from `ConnectionInfo`: for sending msg.
    stage?: string;
    domain?: string;
    connectionId?: string;

    //! from original connection event.
    connected?: number;
    connectedAt?: number;

    /**
     * stat set from node.
     * WARN - save `stat` only in Edge.
     */
    // stat?: StatEntries;

    /**
     * additional meta (format in json)
     */
    meta?: string;
}

/**
 * `connection`: connection model
 * - storage for connection-info of ApiGateway's connection.
 */
export interface ConnectionModel extends Model, ConnectionInfo {
    /**
     * as `conn-id`
     */
    id?: string;
    /**
     * stereo type as initial `role`.
     */
    stereo?: string;
    /**
     * node-id to `Node` model.
     */
    nodeId?: string;

    //! from `ConnectionInfo`: for origin information.
    stage?: string;
    domain?: string;
    connectionId?: string;

    //! from original connection event.
    connected?: number;
    connectedAt?: number;

    //! extended information..
    origin?: string;
    remote?: string;
    agent?: string;
    reason?: string;
}

/**
 * `request`
 * - support synchronous request & response.
 */
export interface RequestModel<T = any> extends Model {
    /**
     * request-id
     */
    id?: string;
    /**
     * target cluster
     */
    cluster?: string;
    /**
     * target stereo
     */
    stereo?: string;
    /**
     * target in edge-id
     */
    target?: string;
    /**
     * requested count
     */
    requested?: number;
    /**
     * finished count
     */
    finished?: number;
    /**
     * finished timestamp.
     */
    finishedAt?: number;
    /**
     * the response result.
     */
    readonly Response?: T;
}

export interface ResponseModel extends Model {
    /**
     * request-id in origin.
     */
    rid?: string;
    /**
     * response-id
     */
    id?: string;
    /**
     * originator.
     */
    source?: string;
    /**
     * response data in json string.
     */
    data?: string;
    /**
     * resource url instead
     */
    url?: string;
    /**
     * error status in json or string.
     */
    error?: string;
}

/**
 * type: `Overridable`
 * - extra definitions for over-writable fields.
 * - see `overrideModel()`
 */
export interface Overridable {
    ns?: string;
    stereo?: string;
    name?: string;
}
export type OverridableKey = keyof Overridable;

/**
 * type: model-type
 * - use this type to make _id per data.
 */
//! extract properties out of Model. (required `ts-node --compiler ttypescript`)
import { keys } from 'ts-transformer-keys';
export const FIELDS: string[] = keys<Model>().filter(_ => !_.startsWith('_'));
export const OVERRIDABLES: OverridableKey[] = keys<Overridable>();

//! extends fields
export const extendsFields = (fields: string[], ext: string[] = [], ext2: string[] = []): string[] =>
    $_.reduce(
        fields,
        (L: string[], field: string) => {
            if (/^[a-z]+/.test(field) && L.indexOf(field) < 0) L.push(field); // only if 1st char is lowercase.
            return L;
        },
        [...FIELDS, ...ext, ...ext2],
    );

/**
 *
 * ```ts
 * const item: ItemModel = { cat:'X' };
 * const prod: ProdModel = { };
 * const x = overrideModel(item, prod);
 * assert(prod.cat == 'X')
 * ```
 * @param source    source model
 * @param target    target model
 * @param force     force to overwrite.
 */
export const overrideModel = <U extends Overridable, V extends Overridable>(
    source: U,
    target: V,
    force: boolean = false,
): V =>
    OVERRIDABLES.reduce((N: Overridable, key: OverridableKey) => {
        const org = source[key];
        const val = target[key];
        /* eslint-disable prettier/prettier */
        if (val === undefined && org !== undefined) N[key] = org as never;      // as default.
        else if (val !== undefined && org === undefined) N[key] = val as never; // keep of target
        else if (val === undefined && org === undefined) delete N[key];         // remove key
        if (force && val !== org) N[key] = org as never;                        // overwrite as org.
        return N;
        /* eslint-enable prettier/prettier */
    }, target) as V;

//! extended fields set of sub-class.
// MyManager에서 super()에 해당 필드 타입을 넣어줘야함
export const $FIELD: { [key: string]: string[] } = {
    cluster: extendsFields(keys<ClusterModel>(), OVERRIDABLES),
    edge: extendsFields(keys<EdgeModel>(), OVERRIDABLES),
    node: extendsFields(keys<NodeModel>(), OVERRIDABLES),
    connection: extendsFields(keys<ConnectionModel>(), OVERRIDABLES),
    request: extendsFields(keys<RequestModel>(), OVERRIDABLES),
    response: extendsFields(keys<ResponseModel>(), OVERRIDABLES),
};
