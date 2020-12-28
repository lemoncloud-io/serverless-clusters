/**
 * `engine.ts`
 * - main index to export
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-07-31 support ECMA 2016.
 * @date        2019-08-09 optimized with `lemon-core#1.0.1`
 * @date        2019-11-26 optimized with `lemon-core#2.0.0`
 * @date        2019-12-03 optimized with `lemon-core#2.0.3`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
/** ********************************************************************************************************************
 *  start initializing `lemon-core` with global `process.env`
 ** ********************************************************************************************************************/
import $engine from 'lemon-core';

//! extract core handlers.
const $lambda = $engine.cores.lambda;
const $web = $lambda.web;
const $sqs = $lambda.sqs;
const $sns = $lambda.sns;

// Loading API Service of NextDecoder
import hello from './api/hello-api'; //NOTE! - it should be `WEBController`.
import cluster from './api/clusters-api'; //NOTE! - it should be `WEBController`.

//! register sub handlers, and listeners.
$web.addController(hello);
$web.addController(cluster);

//! export with used cores services.
export { $lambda, $web, $sqs, $sns };

//! default exports with lambda handler.
const lambda = async (e: any, c: any) => {
    //! trigger to load nest-app.
    // await nest.getServer();
    //! now handle via lambda-handler.
    return $lambda.lambda.handle(e, c);
};
export default { $engine, lambda };
