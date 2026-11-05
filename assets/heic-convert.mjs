const failure = () => new Error('HEIC 사진을 변환하지 못했습니다. 원본은 그대로입니다. 다른 사진을 선택하거나 JPG로 바꿔 다시 첨부해 주세요.');

async function nativeJpeg(file) {
  const url = URL.createObjectURL(file), image = new Image(), canvas = document.createElement('canvas');
  let timer;
  try {
    image.src = url;
    await Promise.race([image.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(failure()), 5000); })]);
    clearTimeout(timer);
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 64000000) throw failure();
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(failure()), 'image/jpeg', 0.9));
  } finally { clearTimeout(timer); image.removeAttribute('src'); URL.revokeObjectURL(url); canvas.width = 1; canvas.height = 1; }
}

function workerJpeg(file) {
  return new Promise((resolve, reject) => {
    let worker, timer, finished = false;
    const finish = (error, blob) => {
      if (finished) return;
      finished = true; clearTimeout(timer); worker?.terminate();
      if (error) reject(failure()); else resolve(blob);
    };
    try {
      worker = new Worker('/__uifb/api/heic-worker.mjs', { type: 'module' });
      timer = setTimeout(() => finish(true), 30000);
      worker.onerror = event => { event.preventDefault(); finish(true); };
      worker.onmessage = ({ data }) => finish(!(data.blob instanceof Blob) || data.blob.type !== 'image/jpeg', data.blob);
      file.arrayBuffer().then(buffer => { if (!finished) worker.postMessage(buffer, [buffer]); }, () => finish(true));
    } catch { finish(true); }
  });
}

export async function convertHeic(file) {
  let blob;
  try { blob = await nativeJpeg(file); } catch { blob = await workerJpeg(file); }
  if (blob.size > 8 * 1024 * 1024) throw new Error('변환한 사진이 8MB를 넘습니다. 더 작은 사진을 첨부해 주세요. 원본은 그대로입니다.');
  return new File([blob], file.name.replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
}
