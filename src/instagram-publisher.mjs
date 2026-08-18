export const DEFAULT_META_GRAPH_API_VERSION = 'v26.0';

export function normalizeMetaGraphApiVersion(value, fallback = DEFAULT_META_GRAPH_API_VERSION) {
  const normalized = String(value ?? '').trim();
  return /^v\d+\.\d+$/.test(normalized) ? normalized : fallback;
}

function graphUrl(path, graphApiVersion) {
  const version = normalizeMetaGraphApiVersion(graphApiVersion);
  return `https://graph.facebook.com/${version}/${String(path).replace(/^\/+/, '')}`;
}

export function isInstagramPublishingEnabled({ testMode, accountId, accessToken }) {
  const enabled = testMode !== true;
  const hasAccountId = typeof accountId === 'string' && accountId.trim().length > 0;
  const hasAccessToken = typeof accessToken === 'string' && accessToken.trim().length > 0;
  return enabled && hasAccountId && hasAccessToken;
}

export function buildInstagramMediaRequest({ accountId, accessToken, imageUrl, caption = '', isCarouselItem = false, graphApiVersion }) {
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
    url: graphUrl(`${encodeURIComponent(accountId)}/media`, graphApiVersion),
    body: params.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
}

export function buildInstagramStoryRequest({ accountId, accessToken, imageUrl, graphApiVersion }) {
  if (!accountId || !accessToken) throw new Error('Instagram Account ID und Access Token müssen konfiguriert sein.');
  if (!imageUrl) throw new Error('Für Instagram fehlt eine gültige Bild-URL.');
  const params = new URLSearchParams({
    access_token: accessToken,
    image_url: imageUrl,
    media_type: 'STORIES',
  });
  return {
    url: graphUrl(`${encodeURIComponent(accountId)}/media`, graphApiVersion),
    body: params.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  };
}

export function buildInstagramCarouselRequest({ accountId, accessToken, creationIds, caption = '', graphApiVersion }) {
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
    url: graphUrl(`${encodeURIComponent(accountId)}/media`, graphApiVersion),
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

export function buildInstagramPublishRequest({ accountId, accessToken, creationId, graphApiVersion }) {
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
    url: graphUrl(`${encodeURIComponent(accountId)}/media_publish`, graphApiVersion),
    body: params.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
}

export function buildInstagramContainerStatusRequest({ creationId, accessToken, graphApiVersion }) {
  if (!creationId || !accessToken) throw new Error('Instagram Container-ID und Access Token müssen konfiguriert sein.');
  return {
    url: `${graphUrl(encodeURIComponent(creationId), graphApiVersion)}?fields=status_code,status`,
    headers: { Authorization: `Bearer ${accessToken}` },
  };
}

export function buildInstagramAccountRequest({ accountId, accessToken, graphApiVersion }) {
  if (!accountId || !accessToken) throw new Error('Instagram Account ID und Access Token müssen konfiguriert sein.');
  return {
    url: `${graphUrl(encodeURIComponent(accountId), graphApiVersion)}?fields=id,username,account_type,media_count`,
    headers: { Authorization: `Bearer ${accessToken}` },
  };
}

function instagramError(payload, fallbackMessage) {
  return String(payload?.error?.message || payload?.status || fallbackMessage).slice(0, 800);
}

export async function waitForInstagramContainer({
  creationId,
  accessToken,
  graphApiVersion,
  fetchImpl = fetch,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = 20,
  intervalMs = 1000,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const request = buildInstagramContainerStatusRequest({ creationId, accessToken, graphApiVersion });
    const response = await fetchImpl(request.url, { method: 'GET', headers: request.headers });
    const payload = await response.json();
    if (!response.ok) throw new Error(instagramError(payload, 'Instagram-Containerstatus konnte nicht gelesen werden.'));
    const status = String(payload?.status_code || payload?.status || '').trim().toUpperCase();
    if (status === 'FINISHED' || status === 'PUBLISHED') return { status, payload };
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(instagramError(payload, `Instagram-Container meldet den Status ${status}.`));
    }
    if (attempt < maxAttempts) await wait(intervalMs);
  }
  throw new Error('Instagram-Container ist noch nicht bereit. Der Job wird später erneut versucht.');
}

export async function inspectInstagramAccount({ accountId, accessToken, graphApiVersion, fetchImpl = fetch }) {
  const request = buildInstagramAccountRequest({ accountId, accessToken, graphApiVersion });
  const response = await fetchImpl(request.url, { method: 'GET', headers: request.headers });
  const payload = await response.json();
  if (!response.ok) throw new Error(instagramError(payload, 'Instagram-Verbindung konnte nicht geprüft werden.'));
  const id = String(payload?.id || '').trim();
  const username = String(payload?.username || '').trim();
  if (!id || !username) throw new Error('Instagram hat keine vollständigen Kontodaten zurückgegeben.');
  return {
    id,
    username,
    accountType: String(payload?.account_type || '').trim() || null,
    mediaCount: Number.isFinite(Number(payload?.media_count)) ? Number(payload.media_count) : null,
    graphApiVersion: normalizeMetaGraphApiVersion(graphApiVersion),
  };
}

async function publishContainer({ accountId, accessToken, creationId, graphApiVersion }) {
  await waitForInstagramContainer({ creationId, accessToken, graphApiVersion });
  const publishRequest = buildInstagramPublishRequest({ accountId, accessToken, creationId, graphApiVersion });
  const publishResponse = await fetch(publishRequest.url, {
    method: 'POST',
    headers: publishRequest.headers,
    body: publishRequest.body,
  });
  const publishPayload = await publishResponse.json();
  if (!publishResponse.ok) throw new Error(instagramError(publishPayload, 'Instagram-Veröffentlichung fehlgeschlagen.'));
  return {
    id: String(publishPayload?.id || creationId),
    status: String(publishPayload?.status || 'published'),
    published: true,
  };
}

export async function publishInstagramImage({ accountId, accessToken, imageUrl, caption, testMode = true, graphApiVersion }) {
  if (!isInstagramPublishingEnabled({ testMode, accountId, accessToken })) {
    throw new Error('Instagram-Publishing ist deaktiviert. Bitte TESTMODE deaktivieren und Zugangsdaten konfigurieren.');
  }

  const createRequest = buildInstagramMediaRequest({ accountId, accessToken, imageUrl, caption, graphApiVersion });
  const creationId = await createInstagramContainer(createRequest, 'Instagram-Container konnte nicht erstellt werden.');
  return publishContainer({ accountId, accessToken, creationId, graphApiVersion });
}

export async function publishInstagramStory({ accountId, accessToken, imageUrl, testMode = true, graphApiVersion }) {
  if (!isInstagramPublishingEnabled({ testMode, accountId, accessToken })) {
    throw new Error('Instagram-Publishing ist deaktiviert. Bitte TESTMODE deaktivieren und Zugangsdaten konfigurieren.');
  }
  const createRequest = buildInstagramStoryRequest({ accountId, accessToken, imageUrl, graphApiVersion });
  const creationId = await createInstagramContainer(createRequest, 'Instagram-Story konnte nicht vorbereitet werden.');
  return publishContainer({ accountId, accessToken, creationId, graphApiVersion });
}

export async function publishInstagramCarousel({ accountId, accessToken, imageUrls, caption, testMode = true, graphApiVersion }) {
  if (!isInstagramPublishingEnabled({ testMode, accountId, accessToken })) {
    throw new Error('Instagram-Publishing ist deaktiviert. Bitte TESTMODE deaktivieren und Zugangsdaten konfigurieren.');
  }
  const urls = Array.isArray(imageUrls) ? imageUrls.map((value) => String(value ?? '').trim()).filter(Boolean) : [];
  if (urls.length < 2 || urls.length > 10) throw new Error('Ein Instagram-Carousel benötigt zwei bis zehn Bilder.');
  const creationIds = [];
  for (const imageUrl of urls) {
    const request = buildInstagramMediaRequest({ accountId, accessToken, imageUrl, isCarouselItem: true, graphApiVersion });
    const creationId = await createInstagramContainer(request, 'Instagram-Carousel-Bild konnte nicht vorbereitet werden.');
    await waitForInstagramContainer({ creationId, accessToken, graphApiVersion });
    creationIds.push(creationId);
  }
  const carouselRequest = buildInstagramCarouselRequest({ accountId, accessToken, creationIds, caption, graphApiVersion });
  const carouselId = await createInstagramContainer(carouselRequest, 'Instagram-Carousel konnte nicht erstellt werden.');
  return publishContainer({ accountId, accessToken, creationId: carouselId, graphApiVersion });
}
