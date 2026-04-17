const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const File = require('../models/File');
const authMiddleware = require('../middleware/auth');

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ 
  storage, 
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only images and PDF allowed'), false);
  }
});

// Upload
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  const newFile = new File({
    user: req.user.id,
    originalName: req.file.originalname,
    fileName: req.file.filename,
    path: req.file.path,
    mimeType: req.file.mimetype,
    size: req.file.size,
    status: 'pending'
  });
  await newFile.save();
  res.json({ msg: 'File uploaded successfully!', file: newFile });
});

// User Dashboard - Apni files
router.get('/', authMiddleware, async (req, res) => {
  const files = await File.find({ user: req.user.id }).sort({ createdAt: -1 });
  res.json(files);
});

// Admin - All files (pending + approved)
router.get('/all', authMiddleware, async (req, res) => {
  const files = await File.find().populate('user', 'name email').sort({ createdAt: -1 });
  res.json(files);
});

// Public Gallery - Sirf Approved files
router.get('/public', async (req, res) => {
  const files = await File.find({ status: 'approved' })
    .populate('user', 'name')
    .sort({ approvedAt: -1 });
  res.json(files);
});

// Approve / Reject by Admin
router.put('/approve/:id', authMiddleware, async (req, res) => {
  const { status } = req.body; // 'approved' or 'rejected'
  const file = await File.findById(req.params.id);
  if (!file) return res.status(404).json({ msg: 'File not found' });

  file.status = status;
  if (status === 'approved') {
    file.isPublic = true;
    file.approvedAt = new Date();
  }
  await file.save();
  res.json({ msg: `File ${status}`, file });
});

// Download (Sirf apni file)
router.get('/download/:id', authMiddleware, async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file || file.user.toString() !== req.user.id) {
    return res.status(403).json({ msg: 'Not authorized' });
  }
  res.download(file.path, file.originalName);
});

module.exports = router;
