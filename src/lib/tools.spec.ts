/**
 * `tools.spec.ts`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect2, _it, loadJsonSync } from 'lemon-core';
import { $base64, convertDDSEvent, convertWSSEvent, parseBase64 } from './tools';

//! create service instance.
export const instance = (type?: string) => {
    const ld = (f: string) => loadJsonSync(`data/${f}${f.endsWith('.json') ? '' : '.json'}`);
    const event = type ? ld(type).event : null;
    const $evt = event ? convertWSSEvent(event) : null;
    return { $evt, event, ld };
};

//! main test body.
describe('Tools', () => {
    //! check `$base64`.
    it('should pass $base64', async done => {
        // Buffer.from('WklOAfLioE0CJPw=', 'base64').toString('hex') => '5a494e01f2e2a04d0224fc'
        // Buffer.from('Wks_-eeMIE0CIjg=', 'base64').toString('hex') => '5a4b3ff9e78c204d022238'

        expect2(() => 'WklOAfLioE0CJPw='.length).toEqual(16);
        expect2(() => $base64.urlDecode('WklOAfLioE0CJPw=')).toEqual('5a494e01f2e2a04d0224fc');
        expect2(() => $base64.urlEncode('5a494e01f2e2a04d0224fc')).toEqual('WklOAfLioE0CJPw=');

        expect2(() => $base64.urlDecode('Wks_-eeMIE0CIjg=')).toEqual('5a4b3ff9e78c204d022238');
        expect2(() => $base64.urlEncode('5a4b3ff9e78c204d022238')).toEqual('Wks_-eeMIE0CIjg=');

        expect2(() => $base64.urlDecode('Wks_-_e-IE0CIjg=')).toEqual('5a4b3ffbf7be204d022238');
        expect2(() => $base64.urlEncode('5a4b3ffbf7be204d022238')).toEqual('Wks_-_e-IE0CIjg=');

        //! test parseBase64()
        expect2(() => parseBase64('Wks_-eeMIE0CIjg=')).toEqual('5a4b3ff9e78c204d022238');

        /* eslint-enable prettier/prettier */
        done();
    });

    //! check `$tools`.
    it('should pass $tools.', async done => {
        const { ld } = instance();
        const conv = (e: any) => convertWSSEvent(e);

        expect2(() => ld('wss-con-event.json').event.requestContext.eventType).toEqual('CONNECT');

        /* eslint-disable prettier/prettier */
        expect2(() => conv(ld('wss-con-event.json').event),  'id,type,route').toEqual({ id:'WklOAHKiIE0FjQw=', type:'CONNECT', route:'$connect' });
        expect2(() => conv(ld('wss-con2-event.json').event), 'id,type,route').toEqual({ id:'Wks_-HahoE0Fl2Q=', type:'CONNECT', route:'$connect' });
        expect2(() => conv(ld('wss-dis-event.json').event),  'id,type,route').toEqual({ id:'WklgCECCoE0FiKA=', type:'DISCONNECT', route:'$disconnect' });
        expect2(() => conv(ld('wss-dis2-event.json').event), 'id,type,route').toEqual({ id:'WkqZ9ErCoE0FsUg=', type:'DISCONNECT', route:'$disconnect' });
        expect2(() => conv(ld('wss-msg-event.json').event),  'id,type,route').toEqual({ id:'WklZ4Fu0IE0Fpgg=', type:'MESSAGE', route:'$default' });
        expect2(() => conv(ld('wss-con2-event.json').event), 'authorization').toEqual({ authorization:'Basic aGVsbzpsZW1vbg==' });
        expect2(() => conv(ld('wss-dis2-event.json').event), 'direction,reason').toEqual({ direction:'IN', reason:'Going away' });

        expect2(() => conv(ld('wss-con3-event.json').event), 'authorization').toEqual({ authorization:'' });
        expect2(() => conv(ld('wss-con4-event.json').event), 'authorization').toEqual({ authorization:'' });
        expect2(() => conv(ld('wss-con5-event.json').event), 'authorization').toEqual({ authorization:'Basic bW9uaXRvcjpsZW1vbg==' });

        expect2(() => conv(ld('wss-msg-event.json').event), 'type,direction,body').toEqual({ type:'MESSAGE', direction:'IN', body:'HELLO' });
        /* eslint-enable prettier/prettier */

        //! test convertDDSEvent().
        if (1) {
            const ID = '7fda1d59-a88f-47d5-8664-b9d1a748d4f8';
            const event = ld('dds-stream-03.json').event;
            const strm03 = convertDDSEvent(event);
            expect2(() => convertDDSEvent({} as any)).toEqual('.Records[] is required!');
            expect2(() => strm03.nodes.length).toEqual(2);
            expect2(() => strm03.nodes.map(N => N.last.id).join(', ')).toEqual([ID, ID].join(', '));
        }

        done();
    });
});
