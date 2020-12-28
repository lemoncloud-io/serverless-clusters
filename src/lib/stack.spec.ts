/**
 * `protocol.spec.ts`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-12-22 initial version, and optimized.
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2 } from 'lemon-core';
import { Stack } from './stack';

//! main test body.
describe('Stack', () => {
    it('should pass basic function', async done => {
        // Buffer.from('WklOAfLioE0CJPw=', 'base64').toString('hex') => '5a494e01f2e2a04d0224fc'
        // Buffer.from('Wks_-eeMIE0CIjg=', 'base64').toString('hex') => '5a4b3ff9e78c204d022238'
        const stack = new Stack();

        expect2(() => stack.size).toEqual(0);
        expect2(() => stack.pop()).toEqual(null);

        expect2(() => stack.push('a')).toEqual(1);
        expect2(() => stack.size).toEqual(1);
        // expect2(() => stack.pop()).toEqual({ next: null, value: 'a' });
        expect2(() => stack.pop()).toEqual('a');
        expect2(() => stack.size).toEqual(0);
        expect2(() => stack.pop()).toEqual(null);

        expect2(() => stack.push('x')).toEqual(1);
        expect2(() => stack.push('y')).toEqual(2);
        expect2(() => stack.size).toEqual(2);
        expect2(() => stack.pop()).toEqual('y');
        expect2(() => stack.size).toEqual(1);

        expect2(() => stack.top).toEqual({ next: null, value: 'x' });
        expect2(() => stack.bottom).toEqual({ next: null, value: 'x' });

        expect2(() => stack.push('z')).toEqual(2);
        expect2(() => stack.top).toEqual({ next: { next: null, value: 'x' }, value: 'z' });
        expect2(() => stack.bottom).toEqual({ next: null, value: 'x' });

        expect2(() => stack.pull()).toEqual('x');
        expect2(() => stack.top).toEqual({ next: null, value: 'z' });
        expect2(() => stack.bottom).toEqual({ next: null, value: 'z' });

        /* eslint-enable prettier/prettier */
        done();
    });
});
