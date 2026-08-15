(function exposeCrestCutout(root) {
  function colorDistance(data, offset, color) {
    const red = data[offset] - color.red;
    const green = data[offset + 1] - color.green;
    const blue = data[offset + 2] - color.blue;
    return Math.sqrt(red * red + green * green + blue * blue);
  }

  function borderIndexes(width, height) {
    const indexes = [];
    for (let x = 0; x < width; x += 1) {
      indexes.push(x, (height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      indexes.push(y * width, y * width + width - 1);
    }
    return indexes;
  }

  function dominantBorderColor(width, height, data) {
    const indexes = borderIndexes(width, height);
    const clusters = new Map();
    let opaque = 0;
    let transparent = 0;
    for (const index of indexes) {
      const offset = index * 4;
      if (data[offset + 3] < 32) {
        transparent += 1;
        continue;
      }
      opaque += 1;
      const key = [data[offset], data[offset + 1], data[offset + 2]]
        .map(channel => Math.round(channel / 24))
        .join(':');
      const cluster = clusters.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
      cluster.count += 1;
      cluster.red += data[offset];
      cluster.green += data[offset + 1];
      cluster.blue += data[offset + 2];
      clusters.set(key, cluster);
    }
    const dominant = [...clusters.values()].sort((left, right) => right.count - left.count)[0];
    if (!dominant) {
      return {
        color: { red: 255, green: 255, blue: 255 },
        dominance: 0,
        transparentRatio: 1,
      };
    }
    return {
      color: {
        red: dominant.red / dominant.count,
        green: dominant.green / dominant.count,
        blue: dominant.blue / dominant.count,
      },
      dominance: opaque ? dominant.count / opaque : 0,
      transparentRatio: indexes.length ? transparent / indexes.length : 0,
    };
  }

  function removeEdgeConnectedBackground(image, options = {}) {
    const { width, height } = image;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Ungültige Bildgröße.');
    }
    const source = image.data;
    if (!source || source.length !== width * height * 4) throw new Error('Ungültige Bilddaten.');
    const data = new Uint8ClampedArray(source);
    const border = dominantBorderColor(width, height, data);
    const totalPixels = width * height;

    if (border.transparentRatio >= 0.15) {
      return {
        width,
        height,
        data,
        metadata: {
          method: 'source-alpha',
          confidence: 1,
          reviewRecommended: false,
          borderDominance: border.dominance,
          transparentBorderRatio: border.transparentRatio,
          removedRatio: 0,
          backgroundColor: null,
        },
      };
    }

    const threshold = Number.isFinite(options.threshold) ? Number(options.threshold) : 44;
    const visited = new Uint8Array(totalPixels);
    const queued = new Uint8Array(totalPixels);
    const queue = new Int32Array(totalPixels);
    let head = 0;
    let tail = 0;
    const enqueue = index => {
      if (queued[index]) return;
      queued[index] = 1;
      queue[tail] = index;
      tail += 1;
    };
    const removable = index => {
      const offset = index * 4;
      return data[offset + 3] < 16 || colorDistance(data, offset, border.color) <= threshold;
    };

    for (const index of borderIndexes(width, height)) {
      if (removable(index)) enqueue(index);
    }

    while (head < tail) {
      const index = queue[head];
      head += 1;
      if (visited[index] || !removable(index)) continue;
      visited[index] = 1;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) enqueue(index - 1);
      if (x + 1 < width) enqueue(index + 1);
      if (y > 0) enqueue(index - width);
      if (y + 1 < height) enqueue(index + width);
    }

    let removed = 0;
    for (let index = 0; index < totalPixels; index += 1) {
      if (!visited[index]) continue;
      const offset = index * 4;
      if (data[offset + 3] >= 16) removed += 1;
      data[offset + 3] = 0;
    }
    const removedRatio = removed / totalPixels;
    const foregroundRatio = 1 - removedRatio;
    const geometryPlausible = foregroundRatio >= 0.02 && foregroundRatio <= 0.9;
    const confidence = Math.max(0, Math.min(1, border.dominance * (geometryPlausible ? 1 : 0.45)));

    return {
      width,
      height,
      data,
      metadata: {
        method: 'edge-connected-background',
        confidence,
        reviewRecommended: confidence < 0.72,
        borderDominance: border.dominance,
        transparentBorderRatio: border.transparentRatio,
        removedRatio,
        backgroundColor: {
          red: Math.round(border.color.red),
          green: Math.round(border.color.green),
          blue: Math.round(border.color.blue),
        },
        threshold,
      },
    };
  }

  function createWhiteLogoVariant(image, options = {}) {
    const { width, height } = image;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Ungültige Bildgröße.');
    }
    const source = image.data;
    if (!source || source.length !== width * height * 4) throw new Error('Ungültige Bilddaten.');

    const data = new Uint8ClampedArray(source);
    let background = options.backgroundColor;
    let hasBackground = background
      && Number.isFinite(Number(background.red))
      && Number.isFinite(Number(background.green))
      && Number.isFinite(Number(background.blue));
    if (!hasBackground) {
      let opaque = 0;
      let nearWhite = 0;
      let colored = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] < 16) continue;
        opaque += 1;
        const whiteDistance = colorDistance(data, index, { red: 255, green: 255, blue: 255 });
        if (whiteDistance <= 18) nearWhite += 1;
        else if (whiteDistance >= 45) colored += 1;
      }
      const whiteRatio = opaque ? nearWhite / opaque : 0;
      const coloredRatio = opaque ? colored / opaque : 0;
      if (whiteRatio > 0 && whiteRatio < 0.45 && coloredRatio >= 0.25) {
        background = { red: 255, green: 255, blue: 255 };
        hasBackground = true;
      }
    }
    const threshold = Number.isFinite(Number(options.threshold)) ? Math.max(1, Number(options.threshold)) : 44;
    const transparentDistance = Math.max(6, threshold * 0.2);
    const opaqueDistance = Math.max(transparentDistance + 1, threshold * 1.35);

    for (let index = 0; index < data.length; index += 4) {
      const originalAlpha = data[index + 3];
      if (!originalAlpha) continue;

      if (hasBackground) {
        const distance = colorDistance(data, index, background);
        const coverage = Math.max(0, Math.min(1,
          (distance - transparentDistance) / (opaqueDistance - transparentDistance),
        ));
        data[index + 3] = Math.round(originalAlpha * coverage);
      }

      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
    }

    return { width, height, data };
  }

  root.BsvCrestCutout = Object.freeze({ removeEdgeConnectedBackground, createWhiteLogoVariant });
})(globalThis);
