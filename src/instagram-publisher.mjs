export function isInstagramPublishingEnabled({ testMode, accountId, accessToken }) {
  const enabled = testMode !== true;
  const hasAccountId = typeof accountId === 'string' && accountId.trim().length > 0;
  const hasAccessToken = typeof accessToken === 'string' && accessToken.trim().length > 0;
  return enabled && hasAccountId && hasAccessToken;
}

export function buildInstagramMediaRequest({ accountId, accessToken, imageUrl, caption = '', isCarouselItem = false }) {
  if (!accountId || !accessToken) {
    throw new Error('Instagram Account ID und Access Token müssen konfiguriert sein.');
  }
  if (!imageUrl) {
    throw new Error('Für Instagram fehlt eine gültige Bild-URL.');
  }

  const params = new URLSearchParams({
    access_token: accessToken,
    image_url: imageUrl,
    media_type: 'IMAGE',
  });

  const safeCaption = String(caption ?? '').trim().slice(0, 2200);
  if (safeCaption) params.set('caption', safeCaption);
  if (isCarouselItem) params.set('is_carousel_item', 'true');

  return {
    url: `https://graph.facebook.com/v20.0/${encodeURIComponent(accountId)}/media`,
    body: params.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
}

export function buildInstagramCarouselRequest({ accountId, accessToken, creationIds, caption = '' }) {
  if (!accountId || !accessToken) {
    throw new Error('Instagram Account ID und Access Token müssen konfiguriert sein.');
  }
  const children = Array.isArray(creationIds) ? creationIds.map((value) => String(value ?? '').trim()).filter(Boolean) : [];
  if (children.length < 2 || children.length > 10) {
    throw new Error('Ein Instagram-Carousel benötigt zwei bis zehn Bilder.');
  }
  const params = new URLSearchParams({
    access_token: accessToken,
    media_type: 'CAROUSEL',
    children: children.join(','),
  });
  const safeCaption = String(caption ?? '').trim().slice(0, 2200);
  if (safeCaption) params.set('caption', safeCaption);
  return {
    url: `https://graph.facebook.com/v20.0/${encodeURIComponent(accountId)}/media`,
    body: params.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  };
}

async function createInstagramContainer(request, fallbackMessage) {
  const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || fallbackMessage);
  const creationId = String(payload.id || payload.creation_id || '').trim();
  if (!creationId) throw new Error('Instagram hat keinen gültigen Container zurückgegeben.');
  return creationId;
}

export function buildInstagramPublishRequest({ accountId, accessToken, creationId }) {
  if (!accountId || !accessToken) {
    throw new Error('Instagram Account ID und Access Token müssen konfiguriert sein.');
  }
  if (!creationId) {
    throw new Error('Instagram creation_id fehlt.');
  }

  const params = new URLSearchParams({
    access_token: accessToken,
    creation_id: creationId,
  });

  return {
    url: `https://graph.facebook.com/v20.0/${encodeURIComponent(accountId)}/media_publish`,
    body: params.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
}

export async function publishInstagramImage({ accountId, accessToken, imageUrl, caption, testMode = true }) {
  if (!isInstagramPublishingEnabled({ testMode, accountId, accessToken })) {
    throw new Error('Instagram-Publishing ist deaktiviert. Bitte TESTMODE deaktivieren und Zugangsdaten konfigurieren.');
  }

  const createRequest = buildInstagramMediaRequest({ accountId, accessToken, imageUrl, caption });
  const creationId = await createInstagramContainer(createRequest, 'Instagram-Container konnte nicht erstellt werden.');

  const publishRequest = buildInstagramPublishRequest({ accountId, accessToken, creationId });
  const publishResponse = await fetch(publishRequest.url, {
    method: 'POST',
    headers: publishRequest.headers,
    body: publishRequest.body,
  });

  const publishPayload = await publishResponse.json();
  if (!publishResponse.ok) {
    const message = publishPayload?.error?.message || 'Instagram-Veröffentlichung fehlgeschlagen.';
    throw new Error(message);
  }

  return {
    id: creationId,
    status: publishPayload.status || 'published',
    published: true,
  };
}

export async function publishInstagramCarousel({ accountId, accessToken, imageUrls, caption, testMode = true }) {
  if (!isInstagramPublishingEnabled({ testMode, accountId, accessToken })) {
    throw new Error('Instagram-Publishing ist deaktiviert. Bitte TESTMODE deaktivieren und Zugangsdaten konfigurieren.');
  }
  const urls = Array.isArray(imageUrls) ? imageUrls.map((value) => String(value ?? '').trim()).filter(Boolean) : [];
  if (urls.length < 2 || urls.length > 10) throw new Error('Ein Instagram-Carousel benötigt zwei bis zehn Bilder.');
  const creationIds = [];
  for (const imageUrl of urls) {
    const request = buildInstagramMediaRequest({ accountId, accessToken, imageUrl, isCarouselItem: true });
    creationIds.push(await createInstagramContainer(request, 'Instagram-Carousel-Bild konnte nicht vorbereitet werden.'));
  }
  const carouselRequest = buildInstagramCarouselRequest({ accountId, accessToken, creationIds, caption });
  const carouselId = await createInstagramContainer(carouselRequest, 'Instagram-Carousel konnte nicht erstellt werden.');
  const publishRequest = buildInstagramPublishRequest({ accountId, accessToken, creationId: carouselId });
  const publishResponse = await fetch(publishRequest.url, {
    method: 'POST',
    headers: publishRequest.headers,
    body: publishRequest.body,
  });
  const publishPayload = await publishResponse.json();
  if (!publishResponse.ok) throw new Error(publishPayload?.error?.message || 'Instagram-Veröffentlichung fehlgeschlagen.');
  return { id: carouselId, status: publishPayload.status || 'published', published: true };
}
