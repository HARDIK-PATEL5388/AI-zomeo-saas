import Link from 'next/link'
import {
  FlaskConical, Sparkles, Users, BookOpen, Calendar, BarChart3,
  CheckCircle, ArrowRight, Star, Zap, Brain, FileText,
  Settings, UserCheck, CreditCard, ToggleLeft, Upload, Activity,
  Stethoscope, Clock, Bell, Lock,
} from 'lucide-react'

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
            <FlaskConical style={{ width: 18, height: 18 }} className="text-white" />
          </div>
          <span className="text-lg font-bold text-gray-900">
            Zomeo<span className="text-primary-600">.ai</span>
          </span>
        </Link>

        {/* Nav Links */}
        <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
          <a href="#features" className="hover:text-primary-600 transition-colors">Features</a>
          <a href="#for-doctors" className="hover:text-primary-600 transition-colors">For Doctors</a>
          <a href="#for-admins" className="hover:text-primary-600 transition-colors">For Admins</a>
          <a href="#pricing" className="hover:text-primary-600 transition-colors">Pricing</a>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
          >
            Login
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </nav>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative pt-32 pb-20 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary-50 via-white to-teal-50 -z-10" />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-primary-100/40 blur-3xl -z-10 translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-teal-100/30 blur-3xl -z-10 -translate-x-1/3 translate-y-1/3" />

      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-3xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary-50 border border-primary-200 rounded-full text-xs font-semibold text-primary-700 mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            AI Powered · 26 Repertories · Real-time AI Analysis
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            World&apos;s Most Advanced{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-500">
              Homeopathy Platform
            </span>
          </h1>

          <p className="text-xl text-gray-600 leading-relaxed mb-10 max-w-2xl mx-auto">
            Zomeo.ai combines 26 classical repertories with advanced AI to give homeopathic doctors
            instant rubric suggestions, smart repertorization, and complete clinic management —
            all in one cloud platform.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
            <Link
              href="/register"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 shadow-lg shadow-emerald-200 transition-all hover:shadow-emerald-300 hover:-translate-y-0.5"
            >
              <Stethoscope className="w-4 h-4" />
              Start Free Trial
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border-2 border-gray-200 text-gray-700 font-semibold rounded-xl hover:border-primary-300 hover:bg-primary-50 transition-colors"
            >
              Sign In to Your Clinic
            </Link>
          </div>

          <p className="text-sm text-gray-400">
            No credit card required · Cancel anytime · HIPAA-ready infrastructure
          </p>
        </div>

        {/* App preview */}
        <div className="mt-16 relative max-w-5xl mx-auto">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-gray-200/60 overflow-hidden">
            {/* Browser bar */}
            <div className="bg-gray-100 border-b border-gray-200 px-4 py-3 flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
              </div>
              <div className="flex-1 mx-4">
                <div className="bg-white rounded-md px-3 py-1 text-xs text-gray-400 border border-gray-200 max-w-xs mx-auto text-center">
                  app.zomeo.ai/analysis
                </div>
              </div>
            </div>
            {/* Fake UI */}
            <div className="bg-gray-50 p-6 min-h-[320px] flex gap-4">
              {/* Sidebar */}
              <div className="w-44 bg-white rounded-xl border border-gray-200 p-3 flex flex-col gap-1 shrink-0">
                <div className="flex items-center gap-2 px-2 py-1.5 mb-2">
                  <div className="w-5 h-5 rounded bg-primary-600" />
                  <span className="text-xs font-bold text-gray-800">Zomeo.ai</span>
                </div>
                {['Dashboard', 'Patients', 'Cases', 'AI Assistant', 'Repertory', 'Analysis', 'Prescriptions', 'Appointments'].map((item, i) => (
                  <div key={item} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${i === 5 ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-500'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${i === 5 ? 'bg-primary-500' : 'bg-gray-300'}`} />
                    {item}
                  </div>
                ))}
              </div>
              {/* Main content */}
              <div className="flex-1 space-y-3">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-gray-800">AI Rubric Suggestions</span>
                    <div className="flex items-center gap-1 text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
                      <Sparkles className="w-3 h-3" />
                      AI
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-3 font-mono">
                    &quot;Fear of death at night with restlessness and anxiety&quot;
                  </div>
                  <div className="space-y-2">
                    {[
                      { path: 'Mind › Fear › Death › Night', remedies: 14, match: 'exact' },
                      { path: 'Mind › Anxiety › Night › Restlessness', remedies: 28, match: 'semantic' },
                      { path: 'Mind › Restlessness › Night › Anxious', remedies: 19, match: 'semantic' },
                    ].map((r) => (
                      <div key={r.path} className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2">
                        <div>
                          <p className="text-xs font-medium text-gray-800">{r.path}</p>
                          <p className="text-xs text-gray-400">{r.remedies} remedies</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.match === 'exact' ? 'bg-green-100 text-green-700' : 'bg-violet-100 text-violet-700'}`}>
                          {r.match}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Ars. Alb.', score: 28, rank: 1, color: 'bg-yellow-50 border-yellow-200' },
                    { label: 'Phosphorus', score: 24, rank: 2, color: 'bg-gray-50 border-gray-200' },
                    { label: 'Aconite', score: 19, rank: 3, color: 'bg-amber-50 border-amber-200' },
                  ].map((r) => (
                    <div key={r.label} className={`${r.color} border rounded-xl p-3`}>
                      <div className="text-xs text-gray-500 mb-0.5">#{r.rank}</div>
                      <div className="text-sm font-bold text-gray-900">{r.label}</div>
                      <div className="text-xs text-primary-600 font-semibold mt-1">Score: {r.score}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────
function StatsBar() {
  const stats = [
    { value: '26', label: 'Classical Repertories' },
    { value: '2M+', label: 'Rubric Entries' },
    { value: 'AI', label: 'AI Engine' },
    { value: '10-Step', label: 'RAG Pipeline' },
    { value: '99.9%', label: 'Uptime SLA' },
    { value: 'RLS', label: 'Multi-tenant Security' },
  ]
  return (
    <section className="border-y border-gray-100 bg-white py-8">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-6">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-2xl font-extrabold text-primary-600 mb-0.5">{s.value}</div>
              <div className="text-xs text-gray-500 font-medium">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Two Roles Section ────────────────────────────────────────────────────────
function TwoRoles() {
  return (
    <section className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-gray-100 border border-gray-200 rounded-full text-xs font-semibold text-gray-600 mb-4">
            Two Roles, One Platform
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-4">
            Built for Doctors <span className="text-gray-300">&amp;</span> Patients
          </h2>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto">
            Zomeo.ai provides a purpose-built portal for doctors to run their clinic efficiently.
          </p>
        </div>

        <div className="max-w-xl mx-auto">
          {/* Doctor Card */}
          <div className="relative overflow-hidden bg-gradient-to-br from-emerald-600 to-teal-600 rounded-3xl p-8 text-white">
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/5 -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-40 h-40 rounded-full bg-white/5 translate-y-1/2 -translate-x-1/2" />
            <div className="relative z-10">
              <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mb-6">
                <Stethoscope className="w-7 h-7 text-white" />
              </div>
              <div className="text-xs font-bold uppercase tracking-widest text-primary-200 mb-2">Role 01</div>
              <h3 className="text-2xl font-extrabold mb-3">Doctor</h3>
              <p className="text-primary-100 text-sm mb-6 leading-relaxed">
                Clinic-scoped workspace for day-to-day homeopathic practice. Access patients,
                cases, AI repertorization, prescriptions, and appointments — all in one dashboard.
              </p>
              <ul className="space-y-2 mb-8">
                {[
                  'AI rubric search & repertorization',
                  'Patient & case management',
                  'Digital prescriptions',
                  'Appointment scheduling + SMS',
                  'Book library & AI assistant',
                  'Follow-up tracking',
                ].map(item => (
                  <li key={item} className="flex items-center gap-2.5 text-sm">
                    <CheckCircle className="w-4 h-4 text-primary-300 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-primary-700 font-semibold rounded-xl text-sm hover:bg-primary-50 transition-colors shadow-lg"
              >
                Start Free Trial
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ badge, title, subtitle }: { badge: string; title: React.ReactNode; subtitle: string }) {
  return (
    <div className="text-center mb-14">
      <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary-50 border border-primary-200 rounded-full text-xs font-semibold text-primary-700 mb-4">
        {badge}
      </div>
      <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-4">{title}</h2>
      <p className="text-lg text-gray-500 max-w-2xl mx-auto">{subtitle}</p>
    </div>
  )
}

// ─── For Doctors ──────────────────────────────────────────────────────────────
function ForDoctors() {
  const features = [
    {
      icon: Brain,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
      title: 'AI Rubric Search',
      desc: 'Describe symptoms in plain language. Our AI instantly maps them to exact rubrics across 26 repertories using semantic + keyword hybrid search.',
    },
    {
      icon: BarChart3,
      color: 'text-primary-600',
      bg: 'bg-primary-50',
      title: 'Smart Repertorization',
      desc: 'Weighted rubric analysis with automatic remedy scoring. See rank, coverage %, and grade breakdown (1–4) in a clean results table.',
    },
    {
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      title: 'Patient Management',
      desc: 'Comprehensive patient profiles with full case history, prescriptions, follow-up tracking, and age/DOB auto-calculation.',
    },
    {
      icon: FileText,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
      title: 'Case Records',
      desc: 'Structured SOAP notes with chief complaints, miasmatic analysis, and complete consultation history. Never lose a case detail.',
    },
    {
      icon: FlaskConical,
      color: 'text-pink-600',
      bg: 'bg-pink-50',
      title: 'Digital Prescriptions',
      desc: 'Generate professional prescriptions with remedy, potency, dose, and repetition. Print or share digitally with patients.',
    },
    {
      icon: Calendar,
      color: 'text-teal-600',
      bg: 'bg-teal-50',
      title: 'Appointment Scheduling',
      desc: 'Calendar management with SMS reminders via BullMQ. Patients receive automated reminders 24h before their visit.',
    },
    {
      icon: BookOpen,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      title: 'Book Library',
      desc: 'Semantic search across 50+ homeopathic reference books. Find relevant passages instantly using pgvector similarity search.',
    },
    {
      icon: Sparkles,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
      title: 'AI Assistant',
      desc: 'AI streaming chat trained on homeopathic context. Ask for prescription suggestions, remedy comparisons, or case analysis.',
    },
    {
      icon: Bell,
      color: 'text-red-600',
      bg: 'bg-red-50',
      title: 'Follow-up Reminders',
      desc: 'Automatic follow-up scheduling with SMS/email notifications. Never miss a critical follow-up consultation.',
    },
  ]

  return (
    <section id="for-doctors" className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-6">
        <SectionHeader
          badge="For Doctors"
          title={<>Everything a Homeopath Needs<br /><span className="text-primary-600">In One Platform</span></>}
          subtitle="Purpose-built tools for modern homeopathic practice. From your first consultation to follow-up, Zomeo.ai has you covered."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title} className="group p-6 rounded-2xl border border-gray-100 hover:border-primary-200 hover:shadow-lg hover:shadow-emerald-50 transition-all bg-white">
              <div className={`w-11 h-11 rounded-xl ${f.bg} flex items-center justify-center mb-4`}>
                <f.icon className={`w-5 h-5 ${f.color}`} />
              </div>
              <h3 className="font-bold text-gray-900 mb-2">{f.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 transition-colors shadow-lg shadow-emerald-200"
          >
            <Stethoscope className="w-4 h-4" />
            Start Your Free Trial as a Doctor
          </Link>
        </div>
      </div>
    </section>
  )
}

// ─── AI Section ───────────────────────────────────────────────────────────────
function AISection() {
  const steps = [
    { n: '01', title: 'Embedding Cache', desc: 'Query embeddings cached in Redis for sub-10ms repeat lookups' },
    { n: '02', title: 'pgvector Search', desc: 'IVFFlat index across 2M+ rubric embeddings (text-embedding-3-small)' },
    { n: '03', title: 'Full-Text Search', desc: 'PostgreSQL FTS with GIN indexes for keyword precision' },
    { n: '04', title: 'RRF Merge', desc: 'Reciprocal Rank Fusion blends vector + keyword results' },
    { n: '05', title: 'Remedy Aggregation', desc: 'Grade-weighted scoring across matched rubrics' },
    { n: '06', title: 'Keynote Fetch', desc: 'Pulls grade-4 keynote symptoms for top remedies' },
    { n: '07', title: 'Prompt Build', desc: 'Structures 26-repertory context into AI system prompt' },
    { n: '08', title: 'AI Stream', desc: 'Token-by-token SSE streaming for real-time response' },
    { n: '09', title: 'Citation Links', desc: 'Every suggestion linked back to source rubric + repertory' },
    { n: '10', title: 'Audit Log', desc: 'Every AI query logged for compliance and traceability' },
  ]

  return (
    <section id="features" className="py-24 bg-gradient-to-br from-gray-900 to-gray-800 text-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 border border-white/20 rounded-full text-xs font-semibold text-primary-400 mb-4">
            <Zap className="w-3.5 h-3.5" />
            10-Step RAG Pipeline
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4">
            AI That Understands{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">
              Homeopathy
            </span>
          </h2>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Not a generic chatbot. Zomeo.ai&apos;s Retrieval-Augmented Generation pipeline searches
            26 repertories simultaneously before generating any recommendation.

          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {steps.map((s) => (
            <div key={s.n} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors">
              <div className="text-xs font-mono text-primary-400 mb-2">{s.n}</div>
              <div className="text-sm font-bold text-white mb-1">{s.title}</div>
              <div className="text-xs text-gray-400 leading-relaxed">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── For Master Admin ─────────────────────────────────────────────────────────
function ForAdmins() {
  const features = [
    {
      icon: UserCheck,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      title: 'Doctor Account Management',
      desc: 'Create, view, and manage all registered doctor accounts. Update profiles, reset credentials, and view usage statistics per doctor.',
    },
    {
      icon: ToggleLeft,
      color: 'text-primary-600',
      bg: 'bg-primary-50',
      title: 'Account Activation / Deactivation',
      desc: 'Instantly activate or suspend any doctor account. Deactivated accounts lose access immediately — no code change required.',
    },
    {
      icon: CreditCard,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
      title: 'Subscription & Plan Management',
      desc: 'Assign, upgrade, downgrade, or cancel doctor subscriptions. Manage Free, Professional, Clinic, and Enterprise plans from one dashboard.',
    },
    {
      icon: Settings,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
      title: 'Plan Configuration',
      desc: 'Define custom plan limits: max patients, AI queries/month, repertory access, and feature flags. Changes apply instantly via RLS policies.',
    },
    {
      icon: Upload,
      color: 'text-teal-600',
      bg: 'bg-teal-50',
      title: 'Repertory Upload & Validation',
      desc: '6-step upload wizard with a 9-stage validation pipeline. Upload new repertory editions and promote them live without downtime.',
    },
    {
      icon: Activity,
      color: 'text-red-600',
      bg: 'bg-red-50',
      title: 'Live Job Monitoring',
      desc: 'Real-time BullMQ job board. Track validation, embedding, and ingestion workers with per-stage progress and error details.',
    },
    {
      icon: BarChart3,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
      title: 'Platform Analytics',
      desc: 'Revenue reports, active subscriptions, churn rate, top features used, and monthly growth charts for business decisions.',
    },
    {
      icon: Lock,
      color: 'text-gray-600',
      bg: 'bg-gray-100',
      title: 'Role-Based Access Control',
      desc: 'Supabase Row Level Security enforces strict data isolation. Doctors only see their clinic data. Admins have cross-tenant visibility.',
    },
  ]

  return (
    <section id="for-admins" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <SectionHeader
          badge="For Master Admin"
          title={<>Complete Control Over<br /><span className="text-blue-600">Your Platform</span></>}
          subtitle="The Master Admin portal gives you full visibility and control over every doctor, subscription, and repertory on the platform."
        />

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
          {features.map((f) => (
            <div key={f.title} className="bg-gray-50 p-5 rounded-2xl border border-gray-100 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-50 transition-all">
              <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center mb-3`}>
                <f.icon className={`w-5 h-5 ${f.color}`} />
              </div>
              <h3 className="font-bold text-gray-900 text-sm mb-1.5">{f.title}</h3>
              <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-400">
            Admin access is managed internally. Contact your platform administrator for credentials.
          </p>
        </div>
      </div>
    </section>
  )
}

// ─── How It Works ─────────────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    {
      n: '1',
      title: 'Register Your Clinic',
      desc: 'Sign up with clinic name and doctor details. Your isolated workspace is provisioned instantly with Row Level Security.',
      icon: FileText,
    },
    {
      n: '2',
      title: 'Add Patients',
      desc: 'Import or manually add patient records. Store full demographics, medical history, and chief complaints.',
      icon: Users,
    },
    {
      n: '3',
      title: 'Open a Case',
      desc: 'Create a new case for a consultation. Document symptoms, history, and observations in structured SOAP format.',
      icon: Clock,
    },
    {
      n: '4',
      title: 'AI-Powered Analysis',
      desc: 'Describe symptoms in plain English. The AI suggests rubrics, runs repertorization, and ranks top remedies.',
      icon: Sparkles,
    },
    {
      n: '5',
      title: 'Prescribe & Follow-up',
      desc: 'Write a digital prescription and schedule a follow-up. Patients receive automated reminders via SMS.',
      icon: CheckCircle,
    },
  ]

  return (
    <section className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-6">
        <SectionHeader
          badge="How It Works"
          title="From Signup to First Prescription"
          subtitle="Get your clinic running on Zomeo.ai in minutes, not days."
        />
        <div className="relative">
          <div className="hidden md:block absolute top-8 left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-emerald-200 via-emerald-400 to-emerald-200 z-0" />
          <div className="grid grid-cols-1 md:grid-cols-5 gap-8 relative z-10">
            {steps.map((s) => (
              <div key={s.n} className="flex flex-col items-center text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary-600 flex items-center justify-center mb-4 shadow-lg shadow-emerald-200">
                  <s.icon className="w-7 h-7 text-white" />
                </div>
                <div className="text-xs font-bold text-primary-600 mb-1">Step {s.n}</div>
                <h3 className="font-bold text-gray-900 mb-2 text-sm">{s.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Pricing ──────────────────────────────────────────────────────────────────
function Pricing() {
  const plans = [
    {
      name: 'Starter',
      price: 'Free',
      period: '14 days',
      color: 'border-gray-200',
      badge: null,
      features: [
        'Up to 50 patients',
        '100 AI queries / month',
        '5 Repertories',
        'Basic case management',
        'Email support',
      ],
      cta: 'Start Free Trial',
      ctaStyle: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
      href: '/register',
    },
    {
      name: 'Professional',
      price: '₹999',
      period: '/ month',
      color: 'border-primary-500',
      badge: 'Most Popular',
      features: [
        'Up to 500 patients',
        '1,000 AI queries / month',
        'All 26 Repertories',
        'Full case management',
        'Appointments + SMS reminders',
        'Book library access',
        'Priority email support',
      ],
      cta: 'Get Professional',
      ctaStyle: 'bg-primary-600 text-white hover:bg-primary-700 shadow-lg shadow-emerald-200',
      href: '/register?plan=professional',
    },
    {
      name: 'Clinic',
      price: '₹2,499',
      period: '/ month',
      color: 'border-blue-400',
      badge: 'Multi-doctor',
      features: [
        'Unlimited patients',
        '5,000 AI queries / month',
        'All 26 Repertories',
        'Up to 5 doctor accounts',
        'Appointments + SMS reminders',
        'Advanced analytics & reports',
        'CCAvenue billing integration',
        'Dedicated support',
      ],
      cta: 'Get Clinic Plan',
      ctaStyle: 'bg-primary-700 text-white hover:bg-primary-800 shadow-lg shadow-primary-200',
      href: '/register?plan=clinic',
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      period: 'pricing',
      color: 'border-gray-200',
      badge: null,
      features: [
        'Unlimited everything',
        'Custom AI query limits',
        'Unlimited doctor accounts',
        'White-label option',
        'On-premise deployment',
        'Custom repertory upload',
        'SLA + dedicated success manager',
      ],
      cta: 'Contact Sales',
      ctaStyle: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
      href: 'mailto:sales@zomeo.ai',
    },
  ]

  return (
    <section id="pricing" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <SectionHeader
          badge="Pricing"
          title={<>Simple, Transparent Pricing<br />for Every Practice Size</>}
          subtitle="Start free, upgrade when you're ready. No hidden fees, no long-term contracts."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((p) => (
            <div
              key={p.name}
              className={`relative bg-white rounded-2xl border-2 ${p.color} p-6 flex flex-col ${p.badge === 'Most Popular' ? 'shadow-2xl shadow-emerald-100 scale-[1.02]' : ''}`}
            >
              {p.badge && (
                <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-bold text-white ${p.badge === 'Most Popular' ? 'bg-primary-600' : 'bg-primary-700'}`}>
                  {p.badge}
                </div>
              )}
              <div className="mb-5">
                <div className="text-sm font-semibold text-gray-500 mb-1">{p.name}</div>
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-extrabold text-gray-900">{p.price}</span>
                  <span className="text-sm text-gray-400 mb-1">{p.period}</span>
                </div>
              </div>
              <ul className="space-y-2.5 mb-6 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={p.href}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold text-center transition-colors ${p.ctaStyle}`}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-gray-400 mt-8">
          All plans include SSL, daily backups, and Supabase PostgreSQL 15 with pgvector.
          Prices are exclusive of GST. Plans are managed by the Master Admin.
        </p>
      </div>
    </section>
  )
}

// ─── Testimonials ─────────────────────────────────────────────────────────────
function Testimonials() {
  const testimonials = [
    {
      quote: "Zomeo.ai cut my repertorization time from 20 minutes to under 3. The AI rubric search is uncannily accurate — it understands symptom language the way a trained homeopath does.",
      name: "Dr. Priya Sharma",
      role: "Classical Homeopath, Mumbai",
      initials: "PS",
      stars: 5,
    },
    {
      quote: "Managing 400+ patients used to mean spreadsheets everywhere. Now everything is in one place — cases, follow-ups, prescriptions. The SMS reminder feature alone has reduced no-shows by 60%.",
      name: "Dr. Rajesh Nair",
      role: "Homeopathic Clinic, Bangalore",
      initials: "RN",
      stars: 5,
    },
    {
      quote: "As an admin, being able to activate/deactivate doctor accounts and manage their subscriptions from one portal is exactly what we needed for our multi-clinic network.",
      name: "Arundhati Mehta",
      role: "Clinic Network Admin, Delhi",
      initials: "AM",
      stars: 5,
    },
  ]

  return (
    <section className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-6">
        <SectionHeader
          badge="Testimonials"
          title="Loved by Homeopaths Across India"
          subtitle="Join hundreds of homeopathic doctors transforming their practice with Zomeo.ai."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map((t) => (
            <div key={t.name} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
              <div className="flex gap-1 mb-4">
                {Array.from({ length: t.stars }).map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                ))}
              </div>
              <p className="text-gray-700 text-sm leading-relaxed mb-5 italic">&quot;{t.quote}&quot;</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-bold">
                  {t.initials}
                </div>
                <div>
                  <div className="font-semibold text-gray-900 text-sm">{t.name}</div>
                  <div className="text-xs text-gray-500">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Final CTA ────────────────────────────────────────────────────────────────
function FinalCTA() {
  return (
    <section className="py-24 bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="text-4xl font-extrabold mb-4">
          Ready to Modernise Your Homeopathic Practice?
        </h2>
        <p className="text-xl text-primary-100 mb-10 max-w-2xl mx-auto">
          Start your free 14-day trial today. No credit card required.
          26 repertories and advanced AI available from day one.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-primary-700 font-bold rounded-xl hover:bg-primary-50 transition-colors shadow-xl"
          >
            <Stethoscope className="w-4 h-4" />
            Start Free Trial
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 border-2 border-white/40 text-white font-bold rounded-xl hover:bg-white/10 transition-colors"
          >
            Sign In
          </Link>
        </div>
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-400 py-14">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
          {/* Brand */}
          <div className="col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-primary-600 flex items-center justify-center">
                <FlaskConical className="w-4 h-4 text-white" />
              </div>
              <span className="text-white font-bold text-base">
                Zomeo<span className="text-primary-400">.ai</span>
              </span>
            </div>
            <p className="text-sm leading-relaxed text-gray-500 max-w-xs">
              India&apos;s most advanced AI-powered homeopathy SaaS platform.
              Built by Hompath Technologies Pvt. Ltd.
            </p>
          </div>

          {/* Product */}
          <div>
            <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">Product</div>
            <ul className="space-y-2 text-sm">
              {['Features', 'Pricing', 'AI Engine', 'Repertories', 'Security'].map(l => (
                <li key={l}><a href="#" className="hover:text-white transition-colors">{l}</a></li>
              ))}
            </ul>
          </div>

          {/* Portals */}
          <div>
            <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">Portals</div>
            <ul className="space-y-2 text-sm">
              <li><Link href="/login" className="hover:text-white transition-colors">Doctor Login</Link></li>
              <li><Link href="/register" className="hover:text-white transition-colors">Doctor Register</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">Legal</div>
            <ul className="space-y-2 text-sm">
              {['Privacy Policy', 'Terms of Service', 'Data Processing', 'Cookie Policy'].map(l => (
                <li key={l}><a href="#" className="hover:text-white transition-colors">{l}</a></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-600">
            © 2025 Hompath Technologies Pvt. Ltd. All rights reserved. · GST: 27XXXXX0000X1Z5
          </p>
          <div className="flex items-center gap-4 text-xs text-gray-600">
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              All systems operational
            </span>
            <span>Made in India 🇮🇳</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

// ─── Root Page ────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <Hero />
      <StatsBar />
      <TwoRoles />
      <ForDoctors />
      <AISection />
      <ForAdmins />
      <HowItWorks />
      <Pricing />
      <Testimonials />
      <FinalCTA />
      <Footer />
    </div>
  )
}
