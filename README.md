# 🔍 Loupe - AI-Powered Photo & Notes Assistant

A Progressive Web App (PWA) that helps you sort photos and scan handwritten notes using AI, with intelligent file tracking to avoid re-processing.

## ✨ Features

### 📸 Photo Sort
- **AI-Powered Analysis**: Evaluates photos based on 25+ quality factors
  - Technical Quality: Sharpness, focus, exposure, color accuracy, noise
  - Subject Quality: Face detection, eyes open, expression, orientation
  - Composition: Rule of thirds, framing, lighting, background quality
- **Automatic Clustering**: Groups similar photos and picks the best one
- **Smart Scoring**: Scores from 0-100 with detailed feedback
- **Export & Share**: Download or share your best shots

### 📝 Notes Scanner
- **Handwriting OCR**: Convert handwritten notes to digital text
- **Smart Formatting**: Structured, bullet points, or outline styles
- **Real-time Streaming**: See text appear as it's being processed
- **Export Options**: Copy, download as Markdown, or share

### 🤖 AI Agent (Desktop Only)
- **Automatic Folder Monitoring**: Watch a folder and auto-process new files
- **Persistent File Tracking**: Never re-scan the same photos
- **Folder-Specific History**: Each folder maintains separate tracking
- **Statistics Display**: See how many files processed vs skipped
- **Manual Control**: Clear history when needed

### 📱 Mobile Support
- **Camera Integration**: Take photos directly from the app
- **Folder Upload**: Select entire folders (Chrome Mobile)
- **Progressive Web App**: Install to home screen
- **Offline Capable**: Works without internet (after first load)

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- Google Gemini API key ([Get one free](https://ai.google.dev/))

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/RightWise.git
cd RightWise
```

2. **Install backend dependencies**
```bash
cd backend
npm install
```

3. **Configure environment variables**
```bash
# Copy example env file
cp .env.example .env

# Edit .env and add your Gemini API key
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-3.5-flash
PORT=3001
```

4. **Start the backend server**
```bash
npm start
```

5. **Start the frontend server** (in a new terminal)
```bash
cd frontend
npx http-server -p 8080 -c-1
```

6. **Open the app**
```
http://localhost:8080
```

## 🎯 Usage

### Photo Sorting

1. **Manual Upload**
   - Drag & drop photos or click "Pick photos"
   - Wait for AI analysis (on-device + cloud)
   - Review scored photos with highlights and issues
   - Export keepers or share

2. **AI Agent (Desktop Chrome/Edge)**
   - Click "🤖 Activate Gallery Agent"
   - Select your photos folder
   - Agent automatically processes new photos
   - History persists across sessions
   - Only new photos are processed

### Notes Scanning

1. **Upload a photo** of handwritten notes
2. **Select formatting style**: Structured, Bullet Points, or Outline
3. **Watch real-time conversion** as AI processes
4. **Export** as Markdown or copy to clipboard

## 🏗️ Architecture

### Backend
```
backend/
├── server.js           # Express server
├── routes/
│   ├── photos.js      # Photo analysis endpoints
│   └── notes.js       # Notes scanning endpoints
├── utils/
│   └── gemini.js      # Gemini AI integration
└── middleware/
    ├── upload.js      # Multer file upload
    └── rateLimiter.js # API rate limiting
```

### Frontend
```
frontend/
├── index.html         # Landing page with splash
├── photos.html        # Photo sorting interface
├── notes.html         # Notes scanning interface
├── js/
│   ├── app.js        # PWA & common utilities
│   ├── agentic.js    # AI Agent with persistence
│   ├── photos.js     # Photo sorting logic
│   └── notes.js      # Notes scanning logic
├── css/
│   └── styles.css    # Design system
└── service-worker.js # PWA offline support
```

## 🔧 Technology Stack

### Frontend
- **Vanilla JavaScript** - No framework dependencies
- **HTML5 Canvas** - On-device image analysis
- **File System Access API** - Desktop folder monitoring
- **IndexedDB** - Persistent file tracking
- **Service Worker** - PWA offline functionality
- **CSS Grid & Flexbox** - Responsive layout

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **Multer** - File upload handling
- **Google Gemini AI** - Vision & text analysis
- **Sharp** - Image processing (future enhancement)

## 📊 AI Agent File Tracking

The AI Agent includes intelligent persistent tracking to prevent re-scanning:

### How It Works
- **Folder-Specific Tracking**: Each folder has its own history
- **File Keys**: `folderName:fileName_size_timestamp`
- **IndexedDB Storage**: Persists across browser restarts
- **Smart Skipping**: Only new files are processed
- **Manual Control**: Clear history button for reset

### Performance
| Scenario | First Time | After Reload |
|----------|-----------|--------------|
| 100 photos | ~60 seconds | <1 second |
| 10 new photos | ~6 seconds | ~6 seconds |
| 0 new photos | N/A | <1 second |

### Example Flow
```
Day 1: Process 25 photos (15 seconds)
Day 2: Add 2 new photos → Process only 2 (1 second)
Day 3: No new photos → Skip all 27 (<1 second)
```

## 🌐 Browser Support

| Feature | Chrome | Edge | Safari | Firefox | Mobile |
|---------|--------|------|--------|---------|--------|
| Photo Sort | ✅ | ✅ | ✅ | ✅ | ✅ |
| Notes Scan | ✅ | ✅ | ✅ | ✅ | ✅ |
| AI Agent (Desktop) | ✅ | ✅ | ❌ | ❌ | ❌ |
| AI Agent (Mobile) | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| PWA Install | ✅ | ✅ | ✅ | ✅ | ✅ |

**Legend:**
- ✅ Full support
- ⚠️ Fallback methods available
- ❌ Not supported

**Notes:**
- AI Agent (Desktop) requires File System Access API (Chrome/Edge only)
- AI Agent (Mobile) uses alternative upload methods
- Safari may clear IndexedDB if storage is low

## 🔐 Privacy & Security

- **On-Device Processing**: Initial quality metrics calculated locally
- **API Communication**: Photos sent to Google Gemini API for advanced analysis
- **No Data Storage**: Backend doesn't store any user files
- **Local Persistence**: File tracking stored in browser only
- **Rate Limiting**: API requests limited to prevent abuse

## 🚧 API Limits

### Gemini Free Tier
- **20 requests per day** per model
- **Resets daily** (PST timezone)
- **Fallback**: On-device scoring when quota exceeded

### Solutions
1. **Use on-device mode**: Set `USE_BACKEND = false` in `photos.js`
2. **Upgrade to paid tier**: [Gemini API Pricing](https://ai.google.dev/pricing)
3. **Use different models**: Switch between models to distribute quota

## 📱 PWA Installation

### Desktop (Chrome/Edge)
1. Click the install icon in the address bar
2. Or: Menu → Install Loupe

### Mobile (All Browsers)
1. Tap browser menu (⋮)
2. Select "Add to Home Screen"
3. Confirm installation

## 🛠️ Development

### Backend Development
```bash
cd backend
npm run dev  # Auto-restart on changes (if nodemon installed)
```

### Frontend Development
```bash
cd frontend
npx http-server -p 8080 -c-1  # Disable caching during dev
```

### Testing Agent Persistence
```bash
# Open test page
http://localhost:8080/test-agent.html

# Run the 3 test buttons:
1. Check Browser Support
2. Test Storage
3. Test Agent
```

## 🐛 Troubleshooting

### "Gemini API quota exceeded"
**Solution:** Set `USE_BACKEND = false` in `frontend/js/photos.js`

### "Agent not activating"
**Check:**
- Using Chrome or Edge desktop?
- File System Access API enabled?
- Not in Incognito mode?

### "Files still re-scanning"
**Check:**
1. Selecting the same folder?
2. IndexedDB enabled in browser settings?
3. Check DevTools → Application → IndexedDB → LoupeAgentDB

### "Taking too long to process"
**Normal:**
- First scan: 10-30 seconds for 10 photos
- After reload: <1 second (files skipped)

**If both slow:**
- Check CPU/memory usage
- Try smaller batches
- Enable on-device mode only

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Google Gemini AI** - Vision and text analysis
- **File System Access API** - Desktop folder monitoring
- **IndexedDB** - Persistent browser storage
- **Inter Font** - Typography
- **Space Grotesk** - Display typography

## 📞 Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Check existing documentation
- Review troubleshooting section

## 🗺️ Roadmap

### Upcoming Features
- [ ] Batch export to specific folders
- [ ] Advanced filtering and search
- [ ] Custom scoring criteria
- [ ] Cloud sync for history
- [ ] Video analysis support
- [ ] Multi-language support
- [ ] Dark mode
- [ ] Export to popular cloud services

### In Progress
- [x] Persistent file tracking ✅
- [x] Folder-specific history ✅
- [x] Statistics dashboard ✅
- [x] Clear history functionality ✅

## 📈 Version History

### v1.2.0 (Current)
- ✅ Added persistent file tracking with IndexedDB v2
- ✅ Folder-specific tracking (separate histories)
- ✅ Statistics display (processed/skipped counts)
- ✅ Clear History button
- ✅ Enhanced AI photo analysis (25+ factors)
- ✅ Mobile agent support with fallback methods

### v1.1.0
- ✅ AI Agent for automatic folder monitoring
- ✅ Desktop File System Access API integration
- ✅ Real-time file detection
- ✅ Mobile upload methods

### v1.0.0
- ✅ Initial release
- ✅ Photo sorting with AI
- ✅ Notes scanning with OCR
- ✅ PWA support
- ✅ Offline capability

---

**Made with ❤️ for photographers and note-takers**

🔍 **Loupe** - Find the perfect shot, every time.
