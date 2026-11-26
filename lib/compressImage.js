// Downscales + re-encodes as JPEG in the browser before upload, so
// cleaners on mobile data aren't sending full-resolution photos.
//
// The image is decoded from an object URL, not a data URL. Reading a 4-5MB
// camera photo as base64 built a string a third bigger than the file on the
// main thread and then parsed it back, which on a mid-range phone was a
// noticeable pause before every upload even started. An object URL points at
// the file as it is. Still an <img> rather than createImageBitmap, because
// <img> applies the camera's EXIF rotation everywhere, and a sideways photo
// of a room is worse than a slow one.
export function compressImage(file, maxDimension = 1600, quality = 0.75) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) return resolve(file);
    let src;
    try {
      src = URL.createObjectURL(file);
    } catch {
      return resolve(file);
    }
    const done = (result) => {
      URL.revokeObjectURL(src);
      resolve(result);
    };
    const img = new Image();
    img.onload = () => {
      try {
        let { naturalWidth: width, naturalHeight: height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => done(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file),
          'image/jpeg',
          quality
        );
      } catch {
        done(file);
      }
    };
    img.onerror = () => done(file);
    img.src = src;
  });
}
