'use strict';

import { expect } from 'chai';
import cls from '../index';

describe("cls edges and regression testing", function () {

    it("minimized test case that caused #6011 patch to fail", function (done) {
        const n = cls.createNamespace("test");
        console.log('+');
        // when the flaw was in the patch, commenting out this line would fix things:
        process.nextTick(function () { console.log('!'); });

        expect(!n.get('state')).to.be.true;

        n.run(function () {
            n.set('state', true);
            expect(n.get('state')).to.be.true;

            process.nextTick(function () {
                expect(n.get('state')).to.be.true;
                done();
            });
        });
    });
});
