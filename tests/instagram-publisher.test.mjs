import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isInstagramPublishingEnabled,
  buildInstagramCarouselRequest,
  buildInstagramContainerStatusRequest,
  buildInstagramMediaRequest,
  buildInstagramPublishRequest,
  buildInstagramStoryRequest,
  inspectInstagramAccount,
  normalizeMetaGraphApiVersion,
  waitForInstagramContainer,
} from '../src/instagram-publisher.mjs';

test('publishing requires valid credentials and disabled test mode', () => {
  assert.equal(isInstagramPublishingEnabled({ testMode: true, accountId: 'abc', accessToken: 'def' }), false);
  assert.equal(isInstagramPublishingEnabled({ testMode: false, accountId: 'abc', accessToken: 'def' }), true);
  assert.equal(isInstagramPublishingEnabled({ testMode: false, accountId: '', accessToken: 'def' }), false);
  assert.equal(isInstagramPublishingEnabled({ testMode: false, accountId: 'abc', accessToken: '' }), false);
});

test('instagram stories use the STORIES media type', () => {
  const request = buildInstagramStoryRequest({
    accountId: '1234567890',
    accessToken: 'secret-token',
    imageUrl: 'https://example.com/story.png',
  });
  assert.match(request.body, /media_type=STORIES/);
  assert.doesNotMatch(request.body, /caption=/);
});

test('instagram carousel requests preserve page order', () => {
  const child = buildInstagramMediaRequest({
    accountId: '1234567890',
    accessToken: 'secret-token',
    imageUrl: 'https://example.com/page-1.png',
    isCarouselItem: true,
  });
  assert.match(child.body, /is_carousel_item=true/);

  const carousel = buildInstagramCarouselRequest({
    accountId: '1234567890',
    accessToken: 'secret-token',
    creationIds: ['page-1', 'page-2', 'page-3'],
    caption: 'Spielbericht',
  });
  assert.match(carousel.body, /media_type=CAROUSEL/);
  assert.match(carousel.body, /children=page-1%2Cpage-2%2Cpage-3/);
  assert.match(carousel.body, /caption=Spielbericht/);
});

test('instagram requests use the current configurable Meta Graph endpoints', () => {
  const createRequest = buildInstagramMediaRequest({
    accountId: '1234567890',
    accessToken: 'secret-token',
    imageUrl: 'https://example.com/story.jpg',
    caption: 'Test Story',
  });

  assert.equal(createRequest.url, 'https://graph.facebook.com/v26.0/1234567890/media');
  assert.match(createRequest.body, /image_url=https%3A%2F%2Fexample.com%2Fstory.jpg/);
  assert.match(createRequest.body, /caption=Test\+Story/);

  const publishRequest = buildInstagramPublishRequest({
    accountId: '1234567890',
    accessToken: 'secret-token',
    creationId: 'abc-123',
  });

  assert.equal(publishRequest.url, 'https://graph.facebook.com/v26.0/1234567890/media_publish');
  assert.match(publishRequest.body, /creation_id=abc-123/);

  const overridden = buildInstagramStoryRequest({
    accountId: '1234567890',
    accessToken: 'secret-token',
    imageUrl: 'https://example.com/story.jpg',
    graphApiVersion: 'v25.0',
  });
  assert.equal(overridden.url, 'https://graph.facebook.com/v25.0/1234567890/media');
  assert.equal(normalizeMetaGraphApiVersion('invalid'), 'v26.0');
});

test('container status requests keep the token out of the URL and wait until finished', async () => {
  const request = buildInstagramContainerStatusRequest({
    creationId: 'container-1',
    accessToken: 'secret-token',
  });
  assert.equal(request.url, 'https://graph.facebook.com/v26.0/container-1?fields=status_code,status');
  assert.equal(request.headers.Authorization, 'Bearer secret-token');
  assert.doesNotMatch(request.url, /secret-token/);

  const states = ['IN_PROGRESS', 'FINISHED'];
  let waits = 0;
  const result = await waitForInstagramContainer({
    creationId: 'container-1',
    accessToken: 'secret-token',
    fetchImpl: async () => ({ ok: true, json: async () => ({ status_code: states.shift() }) }),
    wait: async () => { waits += 1; },
    maxAttempts: 3,
  });
  assert.equal(result.status, 'FINISHED');
  assert.equal(waits, 1);
});

test('instagram connection inspection returns only safe account details', async () => {
  const account = await inspectInstagramAccount({
    accountId: '17841400000000000',
    accessToken: 'secret-token',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://graph.facebook.com/v26.0/17841400000000000?fields=id,username,account_type,media_count');
      assert.equal(options.headers.Authorization, 'Bearer secret-token');
      return {
        ok: true,
        json: async () => ({ id: '17841400000000000', username: 'bsv.testaccount', account_type: 'BUSINESS', media_count: 3 }),
      };
    },
  });
  assert.deepEqual(account, {
    id: '17841400000000000',
    username: 'bsv.testaccount',
    accountType: 'BUSINESS',
    mediaCount: 3,
    graphApiVersion: 'v26.0',
  });
});
