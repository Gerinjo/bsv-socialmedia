import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isInstagramPublishingEnabled,
  buildInstagramCarouselRequest,
  buildInstagramMediaRequest,
  buildInstagramPublishRequest,
} from '../src/instagram-publisher.mjs';

test('publishing requires valid credentials and disabled test mode', () => {
  assert.equal(isInstagramPublishingEnabled({ testMode: true, accountId: 'abc', accessToken: 'def' }), false);
  assert.equal(isInstagramPublishingEnabled({ testMode: false, accountId: 'abc', accessToken: 'def' }), true);
  assert.equal(isInstagramPublishingEnabled({ testMode: false, accountId: '', accessToken: 'def' }), false);
  assert.equal(isInstagramPublishingEnabled({ testMode: false, accountId: 'abc', accessToken: '' }), false);
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

test('instagram requests use the expected Meta Graph endpoints', () => {
  const createRequest = buildInstagramMediaRequest({
    accountId: '1234567890',
    accessToken: 'secret-token',
    imageUrl: 'https://example.com/story.jpg',
    caption: 'Test Story',
  });

  assert.equal(createRequest.url, 'https://graph.facebook.com/v20.0/1234567890/media');
  assert.match(createRequest.body, /image_url=https%3A%2F%2Fexample.com%2Fstory.jpg/);
  assert.match(createRequest.body, /caption=Test\+Story/);

  const publishRequest = buildInstagramPublishRequest({
    accountId: '1234567890',
    accessToken: 'secret-token',
    creationId: 'abc-123',
  });

  assert.equal(publishRequest.url, 'https://graph.facebook.com/v20.0/1234567890/media_publish');
  assert.match(publishRequest.body, /creation_id=abc-123/);
});
