export function isInstagramPublishingEnabled({ testMode, accountId, accessToken }) {
  const enabled = testMode !== true;
  const hasAccountId = typeof accountId === 'string' && accountId.trim().length > 0;
  const hasAccessToken = typeof accessToken === 'string' && accessToken.trim().length > 0;
  return enabled && hasAccountId && hasAccessToken;
}

export function buildInstagramMediaRequest({ accountId, accessToken, imageUrl, caption = '' }) {
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

  return {
    url: `https://graph.facebook.com/v20.0/${encodeURIComponent(accountId)}/media`,
    body: params.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
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
  const createResponse = await fetch(createRequest.url, {
    method: 'POST',
    headers: createRequest.headers,
    body: createRequest.body,
  });

  const createPayload = await createResponse.json();
  if (!createResponse.ok) {
    const message = createPayload?.error?.message || 'Instagram-Container konnte nicht erstellt werden.';
    throw new Error(message);
  }

  const creationId = String(createPayload.id || createPayload.creation_id || '').trim();
  if (!creationId) {
    throw new Error('Instagram hat keinen gültigen Container zurückgegeben.');
  }

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
