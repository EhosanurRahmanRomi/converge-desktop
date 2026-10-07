'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {recoveryPolicy}=require('../src/browser/recovery-policy');
test('an ambiguous, replaced or still-active request never authorizes a replacement Send',()=>{
  for(const change of [{owned:false},{idle:false},{newerUserMessage:true}]){
    assert.equal(recoveryPolicy({owned:true,idle:true,newerUserMessage:false,kind:'timeout',...change}).action,'observe');
  }
});
test('confirmed owned idle provider failures can receive a focused repair while access failures require attention',()=>{
  for(const kind of ['timeout','delivery-error','server-error','generation-error','stream-interrupted','too-long','output-delivery']){
    assert.deepEqual(recoveryPolicy({owned:true,idle:true,newerUserMessage:false,kind}),{category:kind,action:'repair',retryDelayMs:0});
  }
  for(const kind of ['authentication','model-unavailable'])assert.equal(recoveryPolicy({owned:true,idle:true,newerUserMessage:false,kind}).action,'attention');
});
test('provider rate limits delay recovery rather than launching immediate repeated requests',()=>{
  assert.equal(recoveryPolicy({owned:true,idle:true,newerUserMessage:false,kind:'rate-limit'}).retryDelayMs,60000);
});
