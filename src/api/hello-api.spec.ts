/**
 * `hello-api.spec.ts`
 * - sample unit test for `hello-api`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-03 initial version
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, loadJsonSync, $U } from 'lemon-core';
import { app } from '../express';
import request from 'supertest';

//! main test body.
describe('hello-api', () => {
    const $pack = loadJsonSync('package.json');

    it('should pass express route: GET /', async done => {
        const res = await request(app).get('/');
        expect2(() => res.status).toEqual(200);
        expect2(() => res.text.split('\n')[0]).toEqual(`${$pack.name}/${$pack.version}`);
        done();
    });

    it(`should pass GET /hello/0`, async done => {
        const res = await request(app).get(`/hello/0?name=lemon`);
        expect2(res).toMatchObject({
            status: 200,
            text: $U.json({ hello: 'hello-api-controller:hello' }),
        });
        done();
    });

    it(`should pass POST /hello/0`, done => {
        request(app)
            .post(`/hello/0`)
            .set('Authorization', `Basic jest`)
            .type(0 ? 'form' : 'json')
            .send({ name: 'a@b.c' })
            .expect(200, { hello: 'hello-api-controller:hello', body: { name: 'a@b.c' } })
            .end(done);
    });
});
