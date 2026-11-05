// HEIF decode/free pattern adapted from heic-to 1.6.7 (LGPL-3.0-or-later).
// See heic-codec.LICENSE.txt and heic-codec.NOTICE.txt. This worker is owned per conversion.
import buildLibheif from './heic-codec-1.6.7.mjs';

self.onmessage = async ({ data: buffer }) => {
  let lib, decoder, images, canvas;
  try {
    lib = buildLibheif(); decoder = new lib.HeifDecoder(); images = decoder.decode(buffer);
    const image = images.find(i => i.is_primary()) || images[0];
    if (!image) throw new Error('No HEIF image');
    const width = image.get_width(), height = image.get_height();
    if (!(width > 0 && height > 0) || width * height > 64000000) throw new Error('Image dimensions too large');
    const pixels = new ImageData(width, height);
    for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
    const decoded = await new Promise((resolve, reject) => image.display(pixels, result => result ? resolve(result) : reject(new Error('HEIF decode failed'))));
    canvas = new OffscreenCanvas(width, height); canvas.getContext('2d').putImageData(decoded, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    self.postMessage({ blob });
  } catch { self.postMessage({ error: true }); }
  finally {
    for (const image of images || []) image.free();
    if (decoder?.decoder) lib.heif_context_free(decoder.decoder);
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
};
