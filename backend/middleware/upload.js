// middleware/upload.js

const multer = require('multer');

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

const MAX_SIZE_BYTES = parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10) * 1024 * 1024;
const MAX_PHOTOS     = parseInt(process.env.MAX_PHOTOS_PER_BATCH || '20', 10);

function fileFilter(_req, file, cb) {
  if (ALLOWED_MIME.has(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Unsupported type: ${file.mimetype}`));
  }
}

// single photo (notes scanner)
const uploadOneMw = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES, files: 1 },
  fileFilter,
}).single('image');

// batch of photos (photo sort)
const uploadManyMw = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES, files: MAX_PHOTOS },
  fileFilter,
}).array('images', MAX_PHOTOS);

// wrap multer in a promise so routes can use async/await
function promiseUpload(handler) {
  return (req, res, next) =>
    handler(req, res, err => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: multerMessage(err) });
      }
      next(err);
    });
}

function multerMessage(err) {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':       return `File too large. Maximum is ${process.env.MAX_FILE_SIZE_MB || 10} MB per image.`;
    case 'LIMIT_FILE_COUNT':      return `Too many files. Maximum batch size is ${MAX_PHOTOS} images.`;
    case 'LIMIT_UNEXPECTED_FILE': return err.field || 'Unsupported image type.';
    default:                      return err.message || 'Upload error.';
  }
}

module.exports = {
  uploadOne:  promiseUpload(uploadOneMw),
  uploadMany: promiseUpload(uploadManyMw),
};
