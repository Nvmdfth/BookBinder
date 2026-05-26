const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db/db');
const { authenticateToken, JWT_SECRET } = require('../middleware/authMiddleware');

const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../uploads/avatars');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Config Multer storage parameters
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, 'avatar-' + uniqueSuffix + ext);
  },
});

// Enforce image filter validation rules
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

/**
 * PUT /api/users/profile - Update profile details (Email/Password)
 */
router.put('/profile', authenticateToken, async (req, res) => {
  const { email, newPassword, currentPassword } = req.body;
  const userId = req.user.id;

  if (!currentPassword) {
    return res.status(400).json({ error: 'Your current password is required to verify changes.' });
  }

  try {
    // 1. Fetch current credential details
    const userRes = await query(
      'SELECT email, password_hash, role, avatar_url FROM users WHERE id = $1',
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User profile could not be resolved.' });
    }

    const user = userRes.rows[0];

    // 2. Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect current password credential.' });
    }

    let updatedEmail = user.email;
    let updatedHash = user.password_hash;

    // 3. Email Update logic
    if (email && email.trim().toLowerCase() !== user.email) {
      const emailLower = email.trim().toLowerCase();
      // Check if email is already taken
      const checkEmail = await query('SELECT id FROM users WHERE email = $1 AND id <> $2', [emailLower, userId]);
      if (checkEmail.rows.length > 0) {
        return res.status(409).json({ error: 'This email address is already taken by another account.' });
      }
      updatedEmail = emailLower;
    }

    // 4. Password Update logic
    let passwordChanged = false;
    if (newPassword && newPassword.trim().length >= 6) {
      const salt = await bcrypt.genSalt(10);
      updatedHash = await bcrypt.hash(newPassword, salt);
      passwordChanged = true;
    }

    // 5. Update user row in database
    await query(
      'UPDATE users SET email = $1, password_hash = $2, updated_at = NOW() WHERE id = $3',
      [updatedEmail, updatedHash, userId]
    );

    // 6. If password was changed, update token to prevent session logout on current device
    if (passwordChanged) {
      const newSig = updatedHash.slice(-10);
      const token = jwt.sign(
        { userId: userId, role: user.role, pwdSig: newSig },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
    }

    return res.json({
      message: 'Profile details updated successfully.',
      user: {
        id: userId,
        email: updatedEmail,
        role: user.role,
        avatarUrl: user.avatar_url,
      },
    });

  } catch (error) {
    console.error('Profile Update Route Error:', error);
    return res.status(500).json({ error: 'Internal server error processing profile updates.' });
  }
});

/**
 * POST /api/users/profile/avatar - Upload profile avatar image
 */
router.post('/profile/avatar', authenticateToken, (req, res) => {
  upload.single('avatar')(req, res, async (err) => {
    if (err) {
      console.error('Avatar Upload Limit/Mime Error:', err.message);
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No avatar image file was uploaded.' });
    }

    const userId = req.user.id;
    // Map URL path prefix
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    try {
      // 1. Fetch current avatar details to clean up disk storage
      const userRes = await query('SELECT avatar_url FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length > 0) {
        const oldAvatar = userRes.rows[0].avatar_url;
        if (oldAvatar && oldAvatar.startsWith('/uploads/avatars/')) {
          const oldFilename = oldAvatar.split('/').pop();
          const oldFilePath = path.join(uploadDir, oldFilename);
          
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
            console.log(`🗑️ Removed old avatar image from disk storage: ${oldFilePath}`);
          }
        }
      }

      // 2. Map new avatar URL inside user database row
      await query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [avatarUrl, userId]);

      return res.json({
        message: 'Profile picture uploaded successfully.',
        avatarUrl: avatarUrl,
      });

    } catch (error) {
      console.error('Avatar DB Map Error:', error);
      // Clean up orphaned newly uploaded file if DB failed
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(500).json({ error: 'Internal server error mapping profile image.' });
    }
  });
});

module.exports = router;
