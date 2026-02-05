# Formula Student Trainer Platform

A comprehensive training platform for Formula Student teams, featuring AI-powered Q&A, quiz generation, team challenges, and document management.

## 🏎️ Overview

The Formula Student Trainer Platform is designed to help engineering students prepare for Formula Student competitions through:

- **AI-Powered Q&A Chat**: Ask questions about Formula Student rules and regulations
- **Self Quiz Mode**: Practice with both official questions and AI-generated content
- **Team Challenge Mode**: Competitive quiz sessions between teams
- **Document Management**: Upload and process rulebooks, guides, and reference materials
- **Admin Panel**: User management and content administration

## 🏗️ Architecture

### Frontend
- **React 19** with TypeScript
- **Tailwind CSS** for styling
- **Vite** for build tooling
- **Lucide React** for icons

### Backend & Database
- **Supabase** (PostgreSQL with real-time features)
- **Supabase Edge Functions** (Deno runtime)
- **Vector embeddings** for document search (pgvector extension)

### AI & Machine Learning
- **Google Gemini AI** for content generation and embeddings
- **RAG (Retrieval Augmented Generation)** for document-based Q&A

## 🔗 Third-Party Integrations

### 1. Supabase
**Purpose**: Backend-as-a-Service platform providing database, authentication, and serverless functions. ***Please reach the team for third-party credentials.***

**Services Used**:
- PostgreSQL database with vector extensions
- Authentication & user management
- Edge Functions (serverless)
- Real-time subscriptions
- File storage

**Configuration**:
- Database URL: `VITE_SUPABASE_URL`
- Anonymous key: `VITE_SUPABASE_ANON_KEY`
- Service role key: `SUPABASE_SERVICE_ROLE_KEY` (server-side only)

**How to Access**:
1. Visit [supabase.com](https://supabase.com)
2. Create an account or sign in
3. Create a new project
4. Navigate to Settings → API to find your keys
5. Go to Settings → Database to get your database URL

### 2. Google Gemini AI
**Purpose**: AI model for content generation, embeddings, and intelligent responses

**Services Used**:
- `gemini-2.5-flash` - Fast content generation
- `text-embedding-004` - Document embeddings for vector search
- Batch embedding processing

**Configuration**:
- API Key: `GEMINI_API_KEY`

**How to Access**:
1. Visit [Google AI Studio](https://aistudio.google.com)
2. Sign in with your Google account
3. Go to "Get API Key" section
4. Create a new API key
5. Copy the key for your environment variables

### 3. Netlify (Deployment)
**Purpose**: Static site hosting and deployment

**Features**:
- Automatic deployments from Git
- Custom domain support
- CDN distribution
- Build optimization

**How to Access**:
1. Visit [netlify.com](https://netlify.com)
2. Connect your GitHub/GitLab repository
3. Configure build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Supabase account
- Google AI Studio account

### Environment Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd formula-student-trainer
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
Create a `.env` file in the root directory:
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

4. **Configure Supabase**
   - Run the database migrations (found in `supabase/migrations/`)
   - Set up the Edge Functions
   - Configure the `GEMINI_API_KEY` in Supabase Edge Function secrets

5. **Start development server**
```bash
npm run dev
```

### Supabase Setup

1. **Database Schema**
   - Run all migration files in order
   - Ensure the `vector` extension is enabled
   - Verify RLS policies are active

2. **Edge Functions**
   Deploy the following functions to your Supabase project:
   - `chat-rag` - Handles AI-powered Q&A
   - `generate-quiz` - Creates quiz questions
   - `process-document` - Processes uploaded documents
   - `admin-manage-user` - Admin user management
   - `generate-feedback` - AI feedback generation
   - `request-password-reset` - Password reset functionality

3. **Storage**
   - Create a `documents` bucket
   - Configure appropriate storage policies

## 📊 Database Schema

### Core Tables
- `users` - User profiles and admin roles
- `documents` - Uploaded training materials
- `document_sections` - Chunked document content with embeddings
- `team_rooms` - Team challenge sessions
- `room_participants` - Team challenge participants
- `question_bank` - Official Formula Student questions

### Key Features
- **Vector Search**: Uses pgvector for semantic document search
- **Real-time Updates**: Supabase real-time for live team challenges
- **Row Level Security**: Comprehensive RLS policies for data protection

## 🔧 Edge Functions

### chat-rag
**Purpose**: Handles AI-powered Q&A with document context
**Endpoint**: `/functions/v1/chat-rag`
**Input**: `{ query: string, selectedDocuments: string[] }`

### generate-quiz
**Purpose**: Creates quiz questions from documents
**Endpoint**: `/functions/v1/generate-quiz`
**Input**: `{ count: number, selectedDocuments: string[] }`

### process-document
**Purpose**: Processes uploaded documents and generates embeddings
**Endpoint**: `/functions/v1/process-document`
**Input**: Document metadata and content

### admin-manage-user
**Purpose**: Admin operations (delete users, change passwords, toggle admin)
**Endpoint**: `/functions/v1/admin-manage-user`
**Input**: `{ action: string, userId: string, data?: object }`

## 🎯 Key Features

### AI-Powered Q&A
- Upload Formula Student rulebooks and documents
- Ask natural language questions
- Get contextual answers with source references
- Vector-based semantic search

### Quiz System
- **Official Mode**: Questions from Formula Student competitions
- **AI Mode**: Generated questions from uploaded documents
- Multiple question types: single choice, multiple choice, input
- Real-time scoring and feedback

### Team Challenges
- Create rooms with unique codes
- Team-based competitive quizzes
- Real-time updates and scoring
- AI-generated post-game analysis

### Document Management
- PDF and text file upload
- Automatic text extraction
- Vector embedding generation
- Document selection for Q&A context

## 🔐 Security

### Authentication
- Supabase Auth with email/password
- Row Level Security (RLS) on all tables
- Admin role-based access control

### Data Protection
- Server-side API key management
- Secure Edge Function execution
- Encrypted data transmission

## 🚀 Deployment

### Netlify Deployment
1. Connect your repository to Netlify
2. Set environment variables in Netlify dashboard
3. Configure build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`

### Supabase Edge Functions
Deploy functions using the Supabase CLI:
```bash
supabase functions deploy chat-rag
supabase functions deploy generate-quiz
supabase functions deploy process-document
supabase functions deploy admin-manage-user
supabase functions deploy generate-feedback
supabase functions deploy request-password-reset
```

## 📝 Usage

### For Students
1. Sign up for an account
2. Browse available documents or wait for admin to upload content
3. Use Q&A chat to ask questions about Formula Student rules
4. Take self-quizzes to test knowledge
5. Join team challenges using room codes

### For Administrators
1. Access admin panel (first user becomes admin automatically)
2. Upload training documents (PDFs, text files)
3. Manage user accounts
4. Monitor system usage

### For Team Leaders
1. Create team challenge rooms
2. Share room codes with team members
3. Configure quiz settings (question count, time limits)
4. Review post-game AI analysis

## 🛠️ Development

### Project Structure
```
src/
├── components/     # Reusable UI components
├── contexts/       # React contexts (Auth)
├── lib/           # Utilities and configurations
├── pages/         # Main application pages
└── index.css     # Global styles

supabase/
├── functions/     # Edge Functions
└── migrations/    # Database schema migrations
```

### Adding New Features
1. Create new components in `src/components/`
2. Add new pages in `src/pages/`
3. Update routing in `src/App.tsx`
4. Add database changes via new migration files
5. Deploy Edge Functions for server-side logic

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For issues and questions:
1. Check the documentation above
2. Review Supabase logs for Edge Function errors
3. Verify environment variables are set correctly
4. Ensure all third-party services are properly configured

## 🔗 Useful Links

- [Supabase Documentation](https://supabase.com/docs)
- [Google AI Studio](https://aistudio.google.com)
- [Netlify Documentation](https://docs.netlify.com)
- [Formula Student Rules](https://www.formulastudent.de)
