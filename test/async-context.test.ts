'use strict';

import { expect } from 'chai';
import cls from '../index';

describe("cls simple async local context", function () {

    it("asynchronously propagating state with local-context", function (done) {
        const namespace = cls.createNamespace('namespace');
        expect(process.namespaces.namespace).to.exist;

        namespace.run(function () {
            namespace.set('test', 1337);
            expect(namespace.get('test')).to.equal(1337, "namespace is working");
            done();
        });
    });
});
