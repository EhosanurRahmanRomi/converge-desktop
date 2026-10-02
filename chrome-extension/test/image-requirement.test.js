'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hasRequiredFiles, hasAgreement, requiresImageOutput } = require('../background');

test('image edits require actual output while image analysis and document corrections remain distinct', () => {
 assert.equal(requiresImageOutput('Create a poster for a fictional exhibit'),true);
 assert.equal(requiresImageOutput('Please improve this picture and explain the changes'),true);
 assert.equal(requiresImageOutput('Can you enhance it?', ['source.jpg']),true);
 assert.equal(requiresImageOutput('Refine the attached image', ['source.png']),true);
 assert.equal(requiresImageOutput('Describe this image', ['source.png']),false);
 assert.equal(requiresImageOutput('How could I improve this picture?', ['source.png']),false);
 assert.equal(requiresImageOutput('Fix the equation in this image', ['source.png']),false);
 assert.equal(requiresImageOutput('Fix the PDF and describe the image', ['source.pdf','source.png']),false);
 assert.equal(requiresImageOutput('Improve this answer'),false);
});

test('an actual requested image cannot be replaced by an image prompt or a PDF', () => {
 const state = { requireImages:true, requireFiles:false };
 assert.equal(hasRequiredFiles(state,null),false);
 assert.equal(hasRequiredFiles(state,{files:[{mimeType:'application/pdf'}]}),false);
 assert.equal(hasRequiredFiles(state,{files:[{mimeType:'image/png'}]}),true);
});

test('dual textual acceptances cannot agree a missing required generated image', () => {
 const state={requireImages:true,requireFiles:false,candidate:{id:'C1',text:'An image prompt'},acceptedBy:{left:'C1',right:'C1'},issues:[]};
 assert.equal(hasAgreement(state),false);
 state.candidate.media={files:[{mimeType:'image/png'}]};
 assert.equal(hasAgreement(state),true);
});
