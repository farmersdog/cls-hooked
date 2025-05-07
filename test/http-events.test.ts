'use strict';

import * as chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import * as http from 'http';
import cls from '../index';

const expect = chai.expect;
chai.use(sinonChai);

const DATUM1 = 'Hello';
const DATUM2 = 'GoodBye';
const TEST_VALUE = 0x1337;
const PORT = 55667;

describe('cls with http connections', function () {
  this.timeout(1000);

  describe('client server', function clientServerTest() {
    const namespace = cls.createNamespace('http');

    const requestSpy = sinon.spy();
    const requestDataSpy = sinon.spy();
    const responseSpy = sinon.spy();
    const responseDataSpy = sinon.spy();
    let finalContextValue: any;

    before((done) => {
      namespace.run(() => {
        namespace.set('test', TEST_VALUE);
        const server = http.createServer();

        server.on('request', function OnServerConnection(req, res) {
          requestSpy(namespace.get('test'));

          req.on('data', function OnServerSocketData(data) {
            requestDataSpy(data.toString('utf-8'), namespace.get('test'));
            server.close();
            res.end(DATUM2);
          });
        });

        server.listen(PORT, function OnServerListen() {
          namespace.run(() => {
            namespace.set('test', 'MONKEY');

            const request = http.request({host: 'localhost', port: PORT, method: 'POST'}, function OnClientConnect(res) {
              responseSpy(namespace.get('test'));

              res.on('data', function OnClientSocketData(reponseData) {
                responseDataSpy(reponseData.toString('utf-8'), namespace.get('test'));
                done();
              });
            });

            request.write(DATUM1);
          });
        });

        finalContextValue = namespace.get('test');
      });
    });

    it('server request event should be called', () => {
      expect(requestSpy.called).to.be.true;
    });

    it('server request event should receive data', () => {
      expect(requestSpy).to.have.been.calledWith(TEST_VALUE);
    });

    it('server request data event should be called', () => {
      expect(requestDataSpy.called).to.be.true;
    });

    it('server request data event should receive data', () => {
      expect(requestDataSpy).to.have.been.calledWith(DATUM1, TEST_VALUE);
    });

    it('client data event should be called', () => {
      expect(responseSpy.called).to.be.true;
    });

    it('client data event should receive data', () => {
      expect(responseDataSpy).to.have.been.calledWith(DATUM2, 'MONKEY');
    });

    it('final context value should be ' + TEST_VALUE, () => {
      finalContextValue.should.be.equal(TEST_VALUE);
    });
  });
});
