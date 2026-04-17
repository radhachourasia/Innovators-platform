require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
// Ensure all your HTML files are inside a folder named "public"
app.use(express.static(path.join(__dirname, 'public'))); 

// Create uploads directory if not exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// --- MONGODB CONNECTION ---
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/innovators', {
    useNewUrlParser: true, useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Connected')).catch(err => console.log('❌ DB Error:', err));

// --- MODELS ---
const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' }
});
const User = mongoose.model('User', UserSchema);

const FileSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    originalName: String,
    filename: String,
    mimeType: String,
    path: String,
    status: { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'] }
}, { timestamps: true });
const FileModel = mongoose.model('File', FileSchema);

const LectureSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    title: String,
    description: String,
    videoUrl: String
}, { timestamps: true });
const Lecture = mongoose.model('Lecture', LectureSchema);

// --- MIDDLEWARE ---
const auth = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey');
        req.user = decoded; // Now contains id, role, and email
        next();
    } catch (e) { res.status(400).json({ msg: 'Token is not valid' }); }
};

// Check if User is Admin
const isAdmin = (req) => req.user.role === 'admin' || req.user.email === 'radhachourasia7@gmail.com';

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'User already exists' });
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        user = new User({ name, email, password: hashedPassword });
        if (email === 'radhachourasia7@gmail.com') user.role = 'admin';
        await user.save();
        res.json({ msg: 'Registered successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ msg: 'Invalid credentials' });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });
        
        // Add email to JWT payload for checking admin rights securely
        const token = jwt.sign({ id: user._id, role: user.role, email: user.email }, process.env.JWT_SECRET || 'supersecretkey', { expiresIn: '1d' });
        res.json({ token, user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- FILE UPLOAD ROUTES ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

app.post('/api/files/upload', auth, upload.single('file'), async (req, res) => {
    try {
        const newFile = new FileModel({
            user: req.user.id,
            originalName: req.file.originalname,
            filename: req.file.filename,
            mimeType: req.file.mimetype,
            path: req.file.path
        });
        await newFile.save();
        res.json(newFile);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/files', auth, async (req, res) => {
    try {
        const files = await FileModel.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json(files);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/files/public', async (req, res) => {
    try {
        const files = await FileModel.find({ status: 'approved' }).populate('user', 'name').sort({ createdAt: -1 });
        res.json(files);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin Route to get all files
app.get('/api/files/all', auth, async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ msg: 'Access denied' });
    try {
        const files = await FileModel.find().populate('user', 'name email').sort({ createdAt: -1 });
        res.json(files);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin Route to approve/reject
app.put('/api/files/approve/:id', auth, async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ msg: 'Access denied' });
    try {
        const file = await FileModel.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
        res.json(file);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/files/download/:id', auth, async (req, res) => {
    try {
        const file = await FileModel.findById(req.params.id);
        if (!file) return res.status(404).json({ msg: 'File not found' });
        res.download(path.resolve(file.path), file.originalName);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- LECTURE ROUTES ---
app.post('/api/lectures', auth, async (req, res) => {
    try {
        const { title, description, videoUrl } = req.body;
        const newLecture = new Lecture({ user: req.user.id, title, description, videoUrl });
        await newLecture.save();
        res.json(newLecture);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/lectures', async (req, res) => {
    try {
        const lectures = await Lecture.find().populate('user', 'name').sort({ createdAt: -1 });
        res.json(lectures);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

