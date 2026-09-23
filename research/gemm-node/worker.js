const { parentPort, workerData } = require('worker_threads');
const koffi = require('koffi');
const lib = koffi.load(__dirname + '/libgemm.so');
const gemm = lib.func('void gemm_rows(const uint8_t*,const int8_t*,int32_t*,int,int,int,int,int)');
const pin  = lib.func('int pin_to_cpu(int)');
const { A, Ao, Q, Qo, C, Co, M, K, N, i0, i1, cpu } = workerData;
if (cpu !== undefined && cpu >= 0) pin(cpu);   // pin this worker thread
const a = Buffer.from(A, Ao, M*K), q = Buffer.from(Q, Qo, K*N), c = Buffer.from(C, Co, M*N*4);
parentPort.on('message', () => {
  gemm(a, q, c, M, K, N, i0, i1);
  parentPort.postMessage('done');
});
