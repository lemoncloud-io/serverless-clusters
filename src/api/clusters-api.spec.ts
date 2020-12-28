/**
 * `clusters-api.spec.ts`
 * - sample unit test for `clusters-api`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, loadJsonSync } from 'lemon-core';
import { app } from '../express';
import request from 'supertest';

//! main test body.
describe('clusters-api', () => {
    const $pack = loadJsonSync('package.json');

    it('should pass express route: GET /', async done => {
        const res = await request(app).get('/');
        expect2(() => res.status).toEqual(200);
        expect2(() => res.text.split('\n')[0]).toEqual(`${$pack.name}/${$pack.version}`);
        done();
    });
});
