import { useState, useEffect } from "react";
import { auth, db, loginWithGoogle, logout } from "./firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, query, orderBy, onSnapshot, limit, addDoc } from "firebase/firestore";
import {
  Calendar,
  Clock,
  User as UserIcon,
  Phone,
  AlertCircle,
  LogOut,
  LayoutDashboard,
  Activity,
  Plus,
  Terminal,
  Cpu,
  Zap,
  ChevronRight,
  Search,
  Settings,
  Bell,
  X,
  ToggleLeft,
  ToggleRight
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  AreaChart,
  Area
} from "recharts";
import { format, subDays, isAfter } from "date-fns";

interface Appointment {
  id: string;
  patientName: string;
  patientPhone: string;
  reason: string;
  urgency: number;
  preferredTime: string;
  status: "pending" | "confirmed" | "cancelled";
  createdAt: string;
}

interface Log {
  id: string;
  callSid: string;
  event: string;
  data: any;
  timestamp: string;
}

export interface PatientRecord {
  id: string;
  name: string;
  age: number;
  gender: string;
  condition: string;
  priority: "High" | "Medium" | "Low";
  phone: string;
  language: string;
  status: string;
  insurance: string;
  lastVisit: string;
  riskScore: number;
  doctor: string;
  callNotes: string;
}

export const mockPatients: PatientRecord[] = [
  { id: "P001", name: "John Martinez", age: 62, gender: "M", condition: "Hypertension", priority: "Medium", phone: "2105550181", language: "English", status: "Scheduled", insurance: "Blue Cross", lastVisit: "2026-03-28", riskScore: 64, doctor: "Dr. Patel", callNotes: "Confirmed for follow-up" },
  { id: "P002", name: "Aisha Khan", age: 29, gender: "F", condition: "Asthma", priority: "Low", phone: "2105550192", language: "English", status: "Completed", insurance: "Aetna", lastVisit: "2026-04-05", riskScore: 22, doctor: "Dr. Chen", callNotes: "Cleared — no issues" },
  { id: "P003", name: "Michael Johnson", age: 71, gender: "M", condition: "Diabetes", priority: "High", phone: "2105550110", language: "English", status: "Missed", insurance: "Medicare", lastVisit: "2026-02-15", riskScore: 87, doctor: "Dr. Reyes", callNotes: "No answer on 3 attempts" },
  { id: "P004", name: "Sophia Lee", age: 45, gender: "F", condition: "Chronic back pain", priority: "Medium", phone: "2105550133", language: "English", status: "Scheduled", insurance: "Cigna", lastVisit: "2026-03-20", riskScore: 45, doctor: "Dr. Patel", callNotes: "Requested morning slot" },
  { id: "P005", name: "Carlos Rivera", age: 38, gender: "M", condition: "Anxiety", priority: "Low", phone: "2105550177", language: "Spanish", status: "Scheduled", insurance: "Medicaid", lastVisit: "2026-04-01", riskScore: 30, doctor: "Dr. Vasquez", callNotes: "Prefers Spanish-speaking staff" },
  { id: "P006", name: "Emily Davis", age: 54, gender: "F", condition: "COPD", priority: "High", phone: "2105550144", language: "English", status: "In Call Queue", insurance: "UnitedHealth", lastVisit: "2026-03-10", riskScore: 78, doctor: "Dr. Chen", callNotes: "Awaiting callback" },
  { id: "P007", name: "David Wilson", age: 67, gender: "M", condition: "Heart disease", priority: "High", phone: "2105550155", language: "English", status: "Needs Follow-up", insurance: "Medicare", lastVisit: "2026-03-05", riskScore: 91, doctor: "Dr. Reyes", callNotes: "Urgent — cardiology referral pending" },
  { id: "P008", name: "Maria Gonzalez", age: 33, gender: "F", condition: "Thyroid disorder", priority: "Low", phone: "2105550166", language: "Spanish", status: "Completed", insurance: "Medicaid", lastVisit: "2026-04-08", riskScore: 18, doctor: "Dr. Vasquez", callNotes: "Lab results normal" },
  { id: "P009", name: "James Brown", age: 59, gender: "M", condition: "Arthritis", priority: "Medium", phone: "2105550122", language: "English", status: "Scheduled", insurance: "Blue Cross", lastVisit: "2026-03-25", riskScore: 55, doctor: "Dr. Patel", callNotes: "New medication review" },
  { id: "P010", name: "Olivia Smith", age: 26, gender: "F", condition: "Migraine", priority: "Low", phone: "2105550109", language: "English", status: "Cancelled", insurance: "Aetna", lastVisit: "2026-02-20", riskScore: 15, doctor: "Dr. Chen", callNotes: "Patient cancelled — rescheduling" },
  { id: "P011", name: "Robert Taylor", age: 74, gender: "M", condition: "Hypertension", priority: "High", phone: "2105550199", language: "English", status: "In Call Queue", insurance: "Medicare", lastVisit: "2026-03-18", riskScore: 82, doctor: "Dr. Reyes", callNotes: "BP readings elevated" },
  { id: "P012", name: "Neha Patel", age: 41, gender: "F", condition: "Diabetes", priority: "Medium", phone: "2105550118", language: "English", status: "Scheduled", insurance: "Cigna", lastVisit: "2026-04-02", riskScore: 48, doctor: "Dr. Patel", callNotes: "A1C trending up" },
  { id: "P013", name: "Daniel Kim", age: 50, gender: "M", condition: "Post-surgery follow-up", priority: "High", phone: "2105550188", language: "Korean", status: "Needs Follow-up", insurance: "UnitedHealth", lastVisit: "2026-03-12", riskScore: 73, doctor: "Dr. Chen", callNotes: "Incision healing slowly" },
  { id: "P014", name: "Linda Moore", age: 63, gender: "F", condition: "Heart disease", priority: "High", phone: "2105550139", language: "English", status: "Missed", insurance: "Medicare", lastVisit: "2026-02-28", riskScore: 89, doctor: "Dr. Reyes", callNotes: "Voicemail left x2" },
  { id: "P015", name: "Ahmed Ali", age: 47, gender: "M", condition: "Asthma", priority: "Medium", phone: "2105550171", language: "English", status: "Scheduled", insurance: "Blue Cross", lastVisit: "2026-03-30", riskScore: 38, doctor: "Dr. Vasquez", callNotes: "Inhaler refill needed" },
];

const scheduleSlots = [
  { time: "9:00 AM", mon: "P001", tue: "P006", wed: null, thu: "P012", fri: "P015" },
  { time: "10:00 AM", mon: "P004", tue: null, wed: "P009", thu: "P005", fri: null },
  { time: "11:00 AM", mon: null, tue: "P011", wed: "P002", thu: null, fri: "P007" },
  { time: "1:00 PM", mon: "P003", tue: "P008", wed: null, thu: "P013", fri: "P010" },
  { time: "2:00 PM", mon: null, tue: "P014", wed: "P015", thu: null, fri: "P001" },
  { time: "3:00 PM", mon: "P007", tue: null, wed: "P006", thu: "P009", fri: null },
];

const getPatientById = (id: string | null) => id ? mockPatients.find(p => p.id === id) : null;

type View = "dashboard" | "schedule" | "patients" | "developer";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeView, setActiveView] = useState<View>("dashboard");
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);

  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [timeframe, setTimeframe] = useState<"24h" | "7d" | "30d">("30d");

  // ML state
  const [mlScores, setMlScores] = useState<Record<string, { risk_score: number; risk_band: string; priority: string; confidence: number }>>({});
  const [mlLoading, setMlLoading] = useState(false);
  const [modelInfo, setModelInfo] = useState<any>(null);
  const [mlError, setMlError] = useState<string | null>(null);
  const [slotRec, setSlotRec] = useState<{ patientId: string; slots: any[] } | null>(null);


  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const qApts = query(collection(db, "appointments"), orderBy("createdAt", "desc"));
    const unsubApts = onSnapshot(qApts, (snapshot) => {
      setAppointments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Appointment[]);
    });

    const qLogs = query(collection(db, "logs"), orderBy("timestamp", "desc"), limit(50));
    const unsubLogs = onSnapshot(qLogs, (snapshot) => {
      setLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Log[]);
    });

    return () => {
      unsubApts();
      unsubLogs();
    };
  }, [user]);

  // Handle switching modes correctly
  useEffect(() => {
    if (isDeveloperMode) {
      setActiveView("developer");
    } else {
      if (activeView === "developer") setActiveView("dashboard");
    }
  }, [isDeveloperMode]);

  // Filtering based on timeframe
  const filteredAppointments = appointments.filter(a => {
    if (timeframe === "30d") return true; // simplified logic
    const date = new Date(a.createdAt);
    if (timeframe === "7d") return isAfter(date, subDays(new Date(), 7));
    if (timeframe === "24h") return isAfter(date, subDays(new Date(), 1));
    return true;
  });

  const urgencyData = [
    { name: "Low", count: filteredAppointments.filter(a => a.urgency <= 2).length, color: "#10b981" }, // Emerald-500
    { name: "Medium", count: filteredAppointments.filter(a => a.urgency === 3).length, color: "#f59e0b" }, // Amber-500
    { name: "High", count: filteredAppointments.filter(a => a.urgency >= 4).length, color: "#ef4444" }, // Red-500
  ];

  const activityData = filteredAppointments.slice(0, 10).reverse().map((a) => ({
    name: format(new Date(a.createdAt), "MM/dd HH:mm"),
    value: a.urgency
  }));

  const handleManualEntry = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      await addDoc(collection(db, "appointments"), {
        patientName: formData.get("name"),
        patientPhone: formData.get("phone"),
        reason: formData.get("reason"),
        urgency: parseInt(formData.get("urgency") as string),
        preferredTime: formData.get("time"),
        status: "pending",
        createdAt: new Date().toISOString()
      });
      setIsManualEntryOpen(false);
    } catch (error) {
      console.error("Error adding manual entry", error);
    }
  };

  // ── ML helpers ──────────────────────────────────────────────────
  const recalculateRisk = async () => {
    setMlLoading(true);
    setMlError(null);
    try {
      const resp = await fetch("/api/ml/batch/seed", { method: "POST" });
      if (!resp.ok) throw new Error(`ML server returned ${resp.status}`);
      const data = await resp.json();
      const map: Record<string, any> = {};
      data.results.forEach((r: any) => { map[r.id] = r; });
      setMlScores(map);
    } catch (err: any) {
      setMlError(err.message || "ML backend unreachable");
    } finally {
      setMlLoading(false);
    }
  };

  const fetchModelInfo = async () => {
    try {
      const resp = await fetch("/api/ml/model/info");
      if (resp.ok) setModelInfo(await resp.json());
    } catch { /* silent */ }
  };

  const recommendSlot = async (patient: PatientRecord) => {
    try {
      const daysSince = Math.floor((Date.now() - new Date(patient.lastVisit).getTime()) / 86400000);
      const urgency = patient.priority === "High" ? 4 : patient.priority === "Medium" ? 3 : 1;
      const resp = await fetch("/api/ml/recommend/slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          age: patient.age, gender: patient.gender, condition: patient.condition,
          urgency, days_since_visit: daysSince, insurance: patient.insurance,
          language: patient.language, preferred_doctor: patient.doctor,
        }),
      });
      if (!resp.ok) throw new Error("Slot recommendation failed");
      const data = await resp.json();
      setSlotRec({ patientId: patient.id, slots: data.top_slots });
    } catch (err: any) {
      alert("Slot recommendation error: " + err.message);
    }
  };


  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <Activity className="w-12 h-12 text-blue-500" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-slate-900 rounded-[2rem] shadow-2xl shadow-blue-900/20 p-10 text-center border border-slate-800"
        >
          <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-8 rotate-3 shadow-xl shadow-blue-900/50">
            <Activity className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-black text-white mb-4 tracking-tight">MediVoice AI</h1>
          <p className="text-slate-400 mb-10 text-lg leading-relaxed">The future of hospital scheduling. Seamless voice-to-calendar integration.</p>
          <button
            onClick={loginWithGoogle}
            className="w-full py-4 px-6 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-3 shadow-xl hover:shadow-slate-700/50 active:scale-95 border border-slate-700"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Admin Portal Access
          </button>
        </motion.div>
      </div>
    );
  }

  const NavItem = ({ id, icon: Icon, label }: { id: View, icon: any, label: string }) => {
    // Hide developer item if not in developer mode, unless it's strictly developer mode mapping
    if (!isDeveloperMode && id === "developer") return null;
    if (isDeveloperMode && id !== "developer") return null;

    return (
      <button
        onClick={() => setActiveView(id)}
        className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all duration-300 ${activeView === id
          ? "bg-blue-600/20 text-blue-400 shadow-[inset_0_0_20px_rgba(37,99,235,0.1)] border border-blue-500/20 translate-x-1"
          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent"
          }`}
      >
        <Icon className={`w-5 h-5 ${activeView === id ? "animate-pulse" : ""}`} />
        {label}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 flex font-sans text-slate-200">
      {/* Sidebar */}
      <aside className="w-80 bg-slate-900 border-r border-slate-800 hidden lg:flex flex-col p-8 sticky top-0 h-screen">
        <div className="flex items-center gap-4 mb-12 px-2">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/50">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <span className="font-black text-2xl tracking-tighter text-white">MediVoice</span>
        </div>

        <nav className="flex-1 space-y-3">
          <NavItem id="dashboard" icon={LayoutDashboard} label="Overview" />
          <NavItem id="schedule" icon={Calendar} label="Calendar" />
          <NavItem id="patients" icon={UserIcon} label="Patients" />
          <NavItem id="developer" icon={Terminal} label="Dev Console" />
        </nav>

        {/* Mode Switcher */}
        <div className="mt-8 mb-6 p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between cursor-pointer hover:border-slate-700 transition" onClick={() => setIsDeveloperMode(!isDeveloperMode)}>
          <div className="flex items-center gap-3">
            <Cpu className={`w-5 h-5 ${isDeveloperMode ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className="font-bold text-sm text-slate-300">Dev Mode</span>
          </div>
          {isDeveloperMode ? <ToggleRight className="w-6 h-6 text-emerald-400" /> : <ToggleLeft className="w-6 h-6 text-slate-600" />}
        </div>

        <div className="mt-auto pt-6 border-t border-slate-800">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 mb-6 flex items-center gap-4">
            <img src={user.photoURL || ""} alt="" className="w-12 h-12 rounded-2xl shadow-sm border-2 border-slate-800" referrerPolicy="no-referrer" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{user.displayName}</p>
              <p className="text-xs text-slate-400 font-medium truncate">{isDeveloperMode ? 'Developer' : 'Administrator'}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-3 py-4 text-slate-500 hover:text-red-400 font-bold transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Logout System
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col relative">
        <header className="h-24 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-10 flex items-center justify-between sticky top-0 z-20 w-full">
          <div className="flex items-center gap-8 flex-1">
            <div className="relative max-w-md w-full hidden md:block">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input
                type="text"
                placeholder="Search appointments, patients..."
                className="w-full pl-12 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-sm font-medium text-slate-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all placeholder:text-slate-600"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="p-3 text-slate-400 hover:bg-slate-800 rounded-xl transition-colors relative" onClick={() => alert("Notifications coming soon")}>
              <Bell className="w-6 h-6" />
              <span className="absolute top-3 right-3 w-2 h-2 bg-blue-500 rounded-full border-2 border-slate-900 shadow-[0_0_10px_rgba(59,130,246,0.8)] animate-pulse" />
            </button>
            <button className="p-3 text-slate-400 hover:bg-slate-800 rounded-xl transition-colors" onClick={() => alert("Settings coming soon")}>
              <Settings className="w-6 h-6" />
            </button>
            <div className="h-8 w-[1px] bg-slate-800 mx-2" />
            <button
              onClick={() => setIsManualEntryOpen(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] active:scale-95"
            >
              <Plus className="w-5 h-5" />
              Manual Entry
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-10 scroll-smooth custom-scrollbar relative">
          <AnimatePresence mode="wait">
            {activeView === "dashboard" && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-10"
              >
                <div className="flex items-end justify-between">
                  <div>
                    <h2 className="text-4xl font-black tracking-tight mb-2 text-white">Hospital Health</h2>
                    <p className="text-slate-400 font-medium text-lg">Real-time patient flow and AI performance metrics.</p>
                  </div>
                  <div className="flex gap-2">
                    {["24h", "7d", "30d"].map((t: any) => (
                      <button
                        key={t}
                        onClick={() => setTimeframe(t)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border ${timeframe === t
                          ? "bg-slate-800 border-slate-700 text-blue-400 shadow-sm"
                          : "bg-transparent border-transparent text-slate-500 hover:bg-slate-800/50"
                          }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                  {[
                    { label: "Total Calls", val: filteredAppointments.length * 3 + 12, icon: Phone, color: "blue", hex: "rgba(59,130,246,0.1)", textHex: "text-blue-400" },
                    { label: "Booked", val: filteredAppointments.length, icon: Calendar, color: "emerald", hex: "rgba(16,185,129,0.1)", textHex: "text-emerald-400" },
                    { label: "Avg. Urgency", val: (filteredAppointments.reduce((acc, a) => acc + a.urgency, 0) / (filteredAppointments.length || 1)).toFixed(1), icon: Activity, color: "rose", hex: "rgba(244,63,94,0.1)", textHex: "text-rose-400" },
                    { label: "AI Accuracy", val: "98.2%", icon: Zap, color: "amber", hex: "rgba(245,158,11,0.1)", textHex: "text-amber-400" }
                  ].map((s, i) => (
                    <motion.div
                      key={s.label}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="bg-slate-900 p-8 rounded-[2rem] shadow-sm border border-slate-800 hover:border-slate-700 transition-all group overflow-hidden relative"
                    >
                      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-radial from-white to-transparent opacity-5 rounded-full blur-2xl transform translate-x-10 -translate-y-10" />
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`} style={{ backgroundColor: s.hex }}>
                        <s.icon className={`w-7 h-7 ${s.textHex}`} />
                      </div>
                      <p className="text-slate-400 font-bold text-sm uppercase tracking-wider mb-1">{s.label}</p>
                      <p className="text-4xl font-black text-white">{s.val}</p>
                    </motion.div>
                  ))}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                  {/* Activity Chart */}
                  <div className="xl:col-span-2 bg-slate-900 p-10 rounded-[2.5rem] shadow-sm border border-slate-800">
                    <div className="flex items-center justify-between mb-10">
                      <h3 className="text-2xl font-black tracking-tight text-white">Booking Activity</h3>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
                          <span className="text-xs font-bold text-slate-400">Urgency Level</span>
                        </div>
                      </div>
                    </div>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={activityData}>
                          <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b", fontWeight: 600 }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b", fontWeight: 600 }} />
                          <Tooltip
                            contentStyle={{ borderRadius: "20px", border: "1px solid #334155", backgroundColor: "#0f172a", boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.5)", padding: "15px", color: "#e2e8f0" }}
                            itemStyle={{ color: "#3b82f6", fontWeight: "bold" }}
                          />
                          <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={4} fillOpacity={1} fill="url(#colorValue)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Urgency Bar Chart */}
                  <div className="bg-slate-900 p-10 rounded-[2.5rem] shadow-sm border border-slate-800">
                    <h3 className="text-2xl font-black tracking-tight mb-10 text-white">Urgency Split</h3>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={urgencyData}>
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b", fontWeight: 600 }} />
                          <Tooltip cursor={{ fill: "#1e293b" }} contentStyle={{ borderRadius: "20px", border: "1px solid #334155", backgroundColor: "#0f172a" }} />
                          <Bar dataKey="count" radius={[10, 10, 10, 10]} barSize={40}>
                            {urgencyData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* Recent Appointments Table */}
                <div className="bg-slate-900 rounded-[2.5rem] shadow-sm border border-slate-800 overflow-hidden">
                  <div className="p-10 border-b border-slate-800 flex items-center justify-between">
                    <h3 className="text-2xl font-black tracking-tight text-white">Recent Requests</h3>
                    <button onClick={() => setActiveView("patients")} className="text-blue-400 font-bold hover:text-blue-300 hover:underline">View All Records</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-slate-500 text-xs font-black uppercase tracking-widest bg-slate-900/50">
                          <th className="px-10 py-6">Patient</th>
                          <th className="px-10 py-6">Medical Concern</th>
                          <th className="px-10 py-6">Priority</th>
                          <th className="px-10 py-6">Requested Slot</th>
                          <th className="px-10 py-6 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {filteredAppointments.map((apt) => (
                          <tr key={apt.id} className="hover:bg-slate-800/20 transition-colors group">
                            <td className="px-10 py-8">
                              <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-slate-800 border border-slate-700 rounded-2xl flex items-center justify-center text-slate-300 font-black text-lg shadow-inner">
                                  {apt.patientName.charAt(0)}
                                </div>
                                <div>
                                  <p className="font-bold text-lg text-white">{apt.patientName}</p>
                                  <p className="text-sm text-slate-400 font-medium">{apt.patientPhone}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-10 py-8">
                              <p className="text-slate-300 font-medium max-w-xs truncate">{apt.reason}</p>
                            </td>
                            <td className="px-10 py-8">
                              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border font-bold text-xs uppercase ${apt.urgency >= 4 ? "bg-red-500/10 text-red-400 border-red-500/20" :
                                apt.urgency === 3 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                  "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                }`}>
                                <AlertCircle className="w-4 h-4" />
                                Level {apt.urgency}
                              </div>
                            </td>
                            <td className="px-10 py-8 font-bold text-slate-300">
                              {apt.preferredTime}
                            </td>
                            <td className="px-10 py-8 text-right">
                              <button onClick={() => setActiveView("schedule")} className="p-3 bg-slate-800 border border-slate-700 text-slate-400 rounded-xl hover:bg-blue-600 hover:text-white hover:border-blue-500 transition-all shadow-sm">
                                <ChevronRight className="w-5 h-5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {filteredAppointments.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-10 py-12 text-center text-slate-500 font-medium">
                              No appointments found for this timeframe.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeView === "schedule" && (
              <motion.div
                key="schedule"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-10"
              >
                <div className="flex items-end justify-between">
                  <div>
                    <h2 className="text-4xl font-black tracking-tight mb-2 text-white">Full Schedule</h2>
                    <p className="text-slate-400 font-medium text-lg">Calendar view of all incoming appointments.</p>
                  </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] overflow-hidden">
                  <div className="p-8 border-b border-slate-800 flex items-center justify-between">
                    <h3 className="text-xl font-black text-white">This Week — April 14–18</h3>
                    <div className="flex gap-2">
                      <button className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl font-bold text-sm hover:bg-slate-700 transition">← Prev</button>
                      <button className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-500 transition shadow-[0_0_10px_rgba(59,130,246,0.2)]">Today</button>
                      <button className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl font-bold text-sm hover:bg-slate-700 transition">Next →</button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="text-slate-500 text-xs font-black uppercase tracking-widest">
                          <th className="px-6 py-5 text-left border-b border-r border-slate-800 w-28">Time</th>
                          <th className="px-6 py-5 text-center border-b border-r border-slate-800">Mon <span className="text-slate-600">14</span></th>
                          <th className="px-6 py-5 text-center border-b border-r border-slate-800">Tue <span className="text-slate-600">15</span></th>
                          <th className="px-6 py-5 text-center border-b border-r border-slate-800">Wed <span className="text-slate-600">16</span></th>
                          <th className="px-6 py-5 text-center border-b border-r border-slate-800">Thu <span className="text-slate-600">17</span></th>
                          <th className="px-6 py-5 text-center border-b border-slate-800">Fri <span className="text-slate-600">18</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduleSlots.map((slot) => {
                          const days = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
                          return (
                            <tr key={slot.time} className="border-b border-slate-800/50 hover:bg-slate-800/10 transition-colors">
                              <td className="px-6 py-6 border-r border-slate-800 text-slate-400 font-bold text-sm whitespace-nowrap">{slot.time}</td>
                              {days.map((day) => {
                                const patient = getPatientById(slot[day]);
                                return (
                                  <td key={day} className="px-3 py-3 border-r border-slate-800/50 last:border-r-0">
                                    {patient ? (
                                      <div className={`p-3 rounded-2xl border transition-all hover:scale-[1.02] cursor-pointer ${patient.priority === 'High' ? 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10' :
                                          patient.priority === 'Medium' ? 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10' :
                                            'bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10'
                                        }`}>
                                        <p className="font-bold text-sm text-white truncate">{patient.name}</p>
                                        <p className="text-xs text-slate-400 truncate mt-1">{patient.condition}</p>
                                        <p className={`text-[10px] font-black uppercase mt-2 ${patient.priority === 'High' ? 'text-red-400' :
                                            patient.priority === 'Medium' ? 'text-amber-400' : 'text-emerald-400'
                                          }`}>{patient.doctor} · {patient.priority}</p>
                                      </div>
                                    ) : (
                                      <div className="p-3 rounded-2xl border border-dashed border-slate-800 text-center min-h-[76px] flex items-center justify-center">
                                        <span className="text-slate-700 text-xs font-medium">Open</span>
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeView === "patients" && (
              <motion.div
                key="patients"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-10"
              >
                <div className="flex items-end justify-between">
                  <div>
                    <h2 className="text-4xl font-black tracking-tight mb-2 text-white">Patient Database</h2>
                    <p className="text-slate-400 font-medium text-lg">Detailed constituent records.</p>
                  </div>
                </div>
                <div className="bg-slate-900 rounded-[2.5rem] shadow-sm border border-slate-800 overflow-hidden">
                  <div className="p-10 border-b border-slate-800 flex items-center justify-between">
                    <div>
                      <h3 className="text-2xl font-black tracking-tight text-white">All Patients</h3>
                      <p className="text-sm text-slate-500 mt-1">{mockPatients.length} records · Extended dataset</p>
                    </div>
                    <div className="flex gap-3 items-center">
                      {mlError && <span className="text-xs text-rose-400 font-bold">{mlError}</span>}
                      {Object.keys(mlScores).length > 0 && (
                        <span className="text-xs text-emerald-400 font-bold px-3 py-1 bg-emerald-500/10 rounded-lg border border-emerald-500/20">✓ ML Scores Active</span>
                      )}
                      <button
                        onClick={recalculateRisk}
                        disabled={mlLoading}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl font-bold text-sm transition shadow-[0_0_10px_rgba(59,130,246,0.2)] active:scale-95 flex items-center gap-2"
                      >
                        <Zap className={`w-4 h-4 ${mlLoading ? 'animate-spin' : ''}`} />
                        {mlLoading ? 'Calculating...' : 'Recalculate Risk (ML)'}
                      </button>
                      <button className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl font-bold hover:bg-slate-700 transition text-sm">Export CSV</button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-slate-500 text-xs font-black uppercase tracking-widest bg-slate-900/50">
                          <th className="px-8 py-5">Patient</th>
                          <th className="px-6 py-5 text-center">Risk</th>
                          <th className="px-6 py-5">Condition</th>
                          <th className="px-6 py-5">Doctor</th>
                          <th className="px-6 py-5">Insurance</th>
                          <th className="px-6 py-5">Priority</th>
                          <th className="px-6 py-5 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {mockPatients.map((patient) => (
                          <tr key={patient.id} className="hover:bg-slate-800/20 transition-colors group">
                            <td className="px-8 py-6">
                              <div className="flex items-center gap-4">
                                <div className="w-11 h-11 bg-slate-800 border border-slate-700 rounded-2xl flex items-center justify-center text-slate-300 font-black text-base shadow-inner">
                                  {patient.name.charAt(0)}
                                </div>
                                <div>
                                  <p className="font-bold text-white">{patient.name}</p>
                                  <p className="text-xs text-slate-500 font-medium">{patient.id} · {patient.age}{patient.gender} · {patient.phone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-6 text-center">
                              <div className="flex flex-col items-center gap-1">
                                {mlScores[patient.id] ? (
                                  <>
                                    <span className={`text-sm font-black ${mlScores[patient.id].risk_score >= 75 ? 'text-red-400' :
                                        mlScores[patient.id].risk_score >= 40 ? 'text-amber-400' : 'text-emerald-400'
                                      }`}>{mlScores[patient.id].risk_score}</span>
                                    <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full ${mlScores[patient.id].risk_score >= 75 ? 'bg-red-500' :
                                          mlScores[patient.id].risk_score >= 40 ? 'bg-amber-500' : 'bg-emerald-500'
                                        }`} style={{ width: `${mlScores[patient.id].risk_score}%` }} />
                                    </div>
                                    <span className="text-[9px] text-blue-400 font-black uppercase tracking-wider">ML</span>
                                  </>
                                ) : (
                                  <>
                                    <span className={`text-sm font-black ${patient.riskScore >= 75 ? 'text-red-400' :
                                        patient.riskScore >= 40 ? 'text-amber-400' : 'text-emerald-400'
                                      }`}>{patient.riskScore}</span>
                                    <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full ${patient.riskScore >= 75 ? 'bg-red-500' :
                                          patient.riskScore >= 40 ? 'bg-amber-500' : 'bg-emerald-500'
                                        }`} style={{ width: `${patient.riskScore}%` }} />
                                    </div>
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-6">
                              <p className="text-slate-300 font-medium text-sm">{patient.condition}</p>
                              <p className="text-[11px] text-slate-600 mt-1 italic max-w-[180px] truncate">"{patient.callNotes}"</p>
                            </td>
                            <td className="px-6 py-6">
                              <p className="text-slate-300 font-bold text-sm">{patient.doctor}</p>
                              <p className="text-[11px] text-slate-600 mt-0.5">Last: {patient.lastVisit}</p>
                            </td>
                            <td className="px-6 py-6">
                              <span className="px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-xs font-bold">{patient.insurance}</span>
                            </td>
                            <td className="px-6 py-6">
                              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border font-bold text-xs uppercase ${patient.priority === "High" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                                patient.priority === "Medium" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                  "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                }`}>
                                {mlScores[patient.id] ? mlScores[patient.id].priority : patient.priority}
                              </div>
                            </td>
                            <td className="px-6 py-6 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => recommendSlot(patient)}
                                  title="Suggest best appointment slot"
                                  className="p-2 bg-slate-800 border border-slate-700 text-slate-400 rounded-xl hover:bg-blue-600 hover:text-white hover:border-blue-500 transition-all text-xs font-bold"
                                >
                                  <Calendar className="w-4 h-4" />
                                </button>
                                <span className={`font-bold text-sm ${patient.status === "Scheduled" ? "text-emerald-400" :
                                    patient.status === "In Call Queue" ? "text-blue-400" :
                                      patient.status === "Completed" ? "text-slate-400" :
                                        patient.status === "Needs Follow-up" ? "text-amber-400" :
                                          "text-rose-400"
                                  }`}>{patient.status}</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeView === "developer" && (
              <motion.div
                key="developer"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-10"
              >
                <div className="flex items-end justify-between">
                  <div>
                    <h2 className="text-4xl font-black tracking-tight mb-2 text-white">Dev Console</h2>
                    <p className="text-slate-400 font-medium text-lg">Monitor voice workflow execution and system logs.</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl font-bold text-sm shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                      System Online
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                  {/* Workflow Visualization */}
                  <div className="xl:col-span-1 space-y-6">
                    <h3 className="text-xl font-black tracking-tight text-white">Voice Workflow</h3>
                    <div className="bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-slate-800 space-y-8 relative overflow-hidden">
                      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:14px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>

                      {[
                        { step: "01", label: "Call Received", desc: "Twilio webhook triggers /api/voice", icon: Phone },
                        { step: "02", label: "Collect Name", desc: "Gathering speech input for patient identity", icon: UserIcon },
                        { step: "03", label: "Analyze Reason", desc: "Extracting medical concern and urgency", icon: Activity },
                        { step: "04", label: "Slot Matching", desc: "Checking availability and confirming time", icon: Clock },
                        { step: "05", label: "Persistence", desc: "Writing appointment record to Firestore", icon: Cpu }
                      ].map((s, i) => (
                        <div key={s.step} className="flex gap-6 relative z-10">
                          <div className="flex flex-col items-center">
                            <div className="w-12 h-12 bg-slate-800 border border-slate-700 rounded-2xl flex items-center justify-center text-blue-400 font-black shadow-[inset_0_2px_10px_rgba(255,255,255,0.05)]">
                              <s.icon className="w-6 h-6" />
                            </div>
                            {i < 4 && <div className="w-[2px] h-12 bg-slate-800 my-2" />}
                          </div>
                          <div>
                            <p className="text-xs font-black text-blue-500 uppercase tracking-widest mb-1">Step {s.step}</p>
                            <p className="font-bold text-lg mb-1 text-slate-200">{s.label}</p>
                            <p className="text-sm text-slate-500 font-medium leading-relaxed">{s.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Real-time Logs */}
                  <div className="xl:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-black tracking-tight text-white">Live Event Stream</h3>
                      <button
                        onClick={() => { fetchModelInfo(); }}
                        className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl font-bold text-sm hover:bg-slate-700 transition flex items-center gap-2"
                      >
                        <Cpu className="w-4 h-4 text-blue-400" />
                        ML Model Stats
                      </button>
                    </div>

                    {/* ML Model Stats Panel */}
                    {modelInfo && (
                      <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-6 space-y-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-black text-white text-lg">Model Performance</h4>
                          <button onClick={() => setModelInfo(null)} className="text-slate-600 hover:text-slate-400 text-xs">✕ close</button>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800">
                            <p className="text-xs font-black text-blue-400 uppercase tracking-widest mb-3">Risk Model (Random Forest)</p>
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-slate-500 text-sm">MAE</span>
                                <span className="text-white font-bold text-sm">{modelInfo.risk_model.mae ?? 'cached'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-500 text-sm">R² Score</span>
                                <span className="text-emerald-400 font-bold text-sm">{modelInfo.risk_model.r2_score ?? 'cached'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-500 text-sm">Training Rows</span>
                                <span className="text-white font-bold text-sm">{modelInfo.risk_model.training_rows ?? '—'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-500 text-sm">Train Time</span>
                                <span className="text-slate-300 font-bold text-sm">{modelInfo.risk_model.train_time_sec ?? '—'}s</span>
                              </div>
                            </div>
                            {modelInfo.risk_model.feature_importance && (
                              <div className="mt-4 pt-3 border-t border-slate-800">
                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Feature Importance</p>
                                {Object.entries(modelInfo.risk_model.feature_importance).map(([k, v]: any) => (
                                  <div key={k} className="flex items-center gap-2 mb-1">
                                    <span className="text-slate-600 text-[11px] w-32 truncate">{k}</span>
                                    <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(v * 100).toFixed(0)}%` }} />
                                    </div>
                                    <span className="text-slate-400 text-[11px] w-8 text-right">{(v * 100).toFixed(0)}%</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800">
                            <p className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-3">Priority Model (Gradient Boost)</p>
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-slate-500 text-sm">Accuracy</span>
                                <span className="text-emerald-400 font-bold text-sm">{modelInfo.priority_model.accuracy ? `${(modelInfo.priority_model.accuracy * 100).toFixed(1)}%` : 'cached'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-500 text-sm">CV Mean Acc</span>
                                <span className="text-white font-bold text-sm">{modelInfo.priority_model.cv_mean_accuracy ? `${(modelInfo.priority_model.cv_mean_accuracy * 100).toFixed(1)}%` : '—'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-500 text-sm">CV Std</span>
                                <span className="text-slate-300 font-bold text-sm">{modelInfo.priority_model.cv_std ?? '—'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-500 text-sm">Train Time</span>
                                <span className="text-slate-300 font-bold text-sm">{modelInfo.priority_model.train_time_sec ?? '—'}s</span>
                              </div>
                            </div>
                            {modelInfo.priority_model.per_class_f1 && (
                              <div className="mt-4 pt-3 border-t border-slate-800">
                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Per-Class F1</p>
                                {Object.entries(modelInfo.priority_model.per_class_f1).map(([cls, f1]: any) => (
                                  <div key={cls} className="flex items-center gap-2 mb-1">
                                    <span className={`text-[11px] font-bold w-16 ${cls === 'High' ? 'text-red-400' : cls === 'Medium' ? 'text-amber-400' : 'text-emerald-400'
                                      }`}>{cls}</span>
                                    <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full ${cls === 'High' ? 'bg-red-500' : cls === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500'
                                        }`} style={{ width: `${(f1 * 100).toFixed(0)}%` }} />
                                    </div>
                                    <span className="text-slate-400 text-[11px] w-8 text-right">{(f1 * 100).toFixed(0)}%</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="bg-[#0A0F1C] rounded-[2.5rem] p-8 shadow-2xl overflow-hidden h-[500px] flex flex-col border border-slate-800 relative group">
                      <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                      <div className="flex items-center gap-3 mb-6 text-slate-500 font-mono text-xs border-b border-slate-800/50 pb-4 relative z-10">
                        <Terminal className="w-4 h-4 text-blue-500" />
                        <span className="text-blue-400">medivoice-ai-v1.0.4 <span className="text-slate-600">~ tail -f /var/log/voice.log</span></span>
                      </div>

                      <div className="flex-1 overflow-y-auto space-y-4 font-mono text-[13px] custom-scrollbar relative z-10 pr-2">
                        <AnimatePresence initial={false}>
                          {logs.map((log) => (
                            <motion.div
                              key={log.id}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="group/log flex gap-4 hover:bg-slate-800/30 p-2 rounded-lg -mx-2 transition-colors cursor-crosshair"
                            >
                              <span className="text-slate-600 shrink-0">[{format(new Date(log.timestamp), "HH:mm:ss")}]</span>
                              <div className="flex-1">
                                <span className={`font-bold ${log.event.includes("FAILED") ? "text-rose-500" :
                                  log.event.includes("CREATED") ? "text-emerald-400" :
                                    "text-blue-400"
                                  }`}>
                                  {log.event}
                                </span>
                                <span className="text-slate-500 ml-3">sid: {log.callSid.slice(-6)}</span>
                                <div className="mt-2 p-3 bg-slate-900/80 rounded-xl text-slate-300 text-xs hidden group-hover/log:block border border-slate-800 shadow-xl overflow-x-auto whitespace-pre-wrap break-all">
                                  {JSON.stringify(log.data, null, 2)}
                                </div>
                              </div>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Manual Entry Modal Dialog */}
      <AnimatePresence>
        {isManualEntryOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
              onClick={() => setIsManualEntryOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-slate-900 border border-slate-700 rounded-[2rem] p-8 max-w-lg w-full relative z-10 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-2xl font-black text-white">Add Appointment</h3>
                  <p className="text-slate-400 text-sm">Manually insert a record into the system.</p>
                </div>
                <button onClick={() => setIsManualEntryOpen(false)} className="p-2 bg-slate-800 text-slate-400 rounded-xl hover:text-white transition">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleManualEntry} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Patient Name</label>
                  <input required name="name" type="text" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="John Doe" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Phone Number</label>
                  <input required name="phone" type="tel" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="+1234567890" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Medical Reason</label>
                  <input required name="reason" type="text" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="Routine checkout..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Urgency (1-5)</label>
                    <input required name="urgency" type="number" min="1" max="5" defaultValue="3" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Time Slot</label>
                    <input required name="time" type="text" defaultValue="10:00 AM" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
                  </div>
                </div>

                <div className="pt-4">
                  <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl shadow-[0_0_15px_rgba(37,99,235,0.3)] transition transform active:scale-95">
                    Save Appointment
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Slot Recommendation Modal */}
      <AnimatePresence>
        {slotRec && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
              onClick={() => setSlotRec(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-slate-900 border border-slate-700 rounded-[2rem] p-8 max-w-xl w-full relative z-10 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <p className="text-xs font-black text-blue-400 uppercase tracking-widest mb-1">ML Slot Recommender</p>
                  <h3 className="text-2xl font-black text-white">Top 3 Slots</h3>
                  <p className="text-slate-400 text-sm">For patient {slotRec.patientId} — ranked by urgency, risk & availability</p>
                </div>
                <button onClick={() => setSlotRec(null)} className="p-2 bg-slate-800 text-slate-400 rounded-xl hover:text-white transition">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                {slotRec.slots.map((slot: any, i: number) => (
                  <div key={slot.slot_id} className={`p-5 rounded-2xl border flex items-center gap-5 ${i === 0 ? 'bg-blue-500/5 border-blue-500/20' : 'bg-slate-950 border-slate-800'
                    }`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg shrink-0 ${i === 0 ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                      }`}>#{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <p className="font-bold text-white">{slot.day} · {slot.time}</p>
                        {i === 0 && <span className="text-[10px] font-black uppercase text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">Best Match</span>}
                      </div>
                      <p className="text-sm text-slate-400 mt-0.5">{slot.doctor} · Load: {slot.doctor_load}</p>
                      <div className="flex gap-4 mt-2">
                        <span className="text-[11px] text-slate-600">Score: <span className="text-slate-300 font-bold">{slot.score}</span></span>
                        <span className="text-[11px] text-slate-600">Urgency: <span className="text-amber-400 font-bold">{slot.reasoning.urgency_score}</span></span>
                        <span className="text-[11px] text-slate-600">Risk: <span className="text-red-400 font-bold">{slot.reasoning.risk_contrib}</span></span>
                      </div>
                    </div>
                    <button
                      onClick={() => { setSlotRec(null); setActiveView("schedule"); }}
                      className="p-2 bg-slate-800 text-slate-400 rounded-xl hover:bg-blue-600 hover:text-white transition shrink-0"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
      `}</style>
    </div>
  );
}
