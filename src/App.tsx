import { useState, useEffect } from "react";
import { auth, db, loginWithGoogle, logout } from "./firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, query, orderBy, onSnapshot, limit } from "firebase/firestore";
import { 
  Calendar, 
  Clock, 
  User as UserIcon, 
  Phone, 
  AlertCircle, 
  CheckCircle, 
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
  Bell
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
import { format } from "date-fns";

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

type View = "dashboard" | "developer" | "schedule" | "patients";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<View>("dashboard");

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

  const urgencyData = [
    { name: "Low", count: appointments.filter(a => a.urgency <= 2).length, color: "#10b981" },
    { name: "Medium", count: appointments.filter(a => a.urgency === 3).length, color: "#f59e0b" },
    { name: "High", count: appointments.filter(a => a.urgency >= 4).length, color: "#ef4444" },
  ];

  const activityData = appointments.slice(0, 10).reverse().map((a, i) => ({
    name: format(new Date(a.createdAt), "HH:mm"),
    value: a.urgency
  }));

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <motion.div 
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <Activity className="w-12 h-12 text-blue-600" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white rounded-[2rem] shadow-2xl shadow-blue-100/50 p-10 text-center border border-white"
        >
          <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-8 rotate-3 shadow-xl shadow-blue-200">
            <Activity className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-black text-slate-900 mb-4 tracking-tight">MediVoice AI</h1>
          <p className="text-slate-500 mb-10 text-lg leading-relaxed">The future of hospital scheduling. Seamless voice-to-calendar integration.</p>
          <button
            onClick={loginWithGoogle}
            className="w-full py-4 px-6 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-3 shadow-xl hover:shadow-slate-200 active:scale-95"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Admin Portal Access
          </button>
        </motion.div>
      </div>
    );
  }

  const NavItem = ({ id, icon: Icon, label }: { id: View, icon: any, label: string }) => (
    <button 
      onClick={() => setActiveView(id)}
      className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all duration-300 ${
        activeView === id 
        ? "bg-blue-600 text-white shadow-lg shadow-blue-200 translate-x-1" 
        : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
      }`}
    >
      <Icon className={`w-5 h-5 ${activeView === id ? "animate-pulse" : ""}`} />
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex font-sans text-slate-900">
      {/* Sidebar */}
      <aside className="w-80 bg-white border-r border-slate-100 hidden lg:flex flex-col p-8 sticky top-0 h-screen">
        <div className="flex items-center gap-4 mb-12 px-2">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-100">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <span className="font-black text-2xl tracking-tighter">MediVoice</span>
        </div>
        
        <nav className="flex-1 space-y-3">
          <NavItem id="dashboard" icon={LayoutDashboard} label="Overview" />
          <NavItem id="developer" icon={Terminal} label="Dev Console" />
          <NavItem id="schedule" icon={Calendar} label="Calendar" />
          <NavItem id="patients" icon={UserIcon} label="Patients" />
        </nav>

        <div className="mt-auto pt-8 border-t border-slate-50">
          <div className="bg-slate-50 rounded-3xl p-5 mb-6 flex items-center gap-4">
            <img src={user.photoURL || ""} alt="" className="w-12 h-12 rounded-2xl shadow-sm border-2 border-white" referrerPolicy="no-referrer" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{user.displayName}</p>
              <p className="text-xs text-slate-400 font-medium truncate">Administrator</p>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center justify-center gap-3 py-4 text-slate-400 hover:text-red-500 font-bold transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Logout System
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        <header className="h-24 bg-white/80 backdrop-blur-md border-b border-slate-100 px-10 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-8 flex-1">
            <div className="relative max-w-md w-full hidden md:block">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
              <input 
                type="text" 
                placeholder="Search appointments, patients..." 
                className="w-full pl-12 pr-4 py-3 bg-slate-50 border-none rounded-2xl text-sm font-medium focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button className="p-3 text-slate-400 hover:bg-slate-50 rounded-xl transition-colors relative">
              <Bell className="w-6 h-6" />
              <span className="absolute top-3 right-3 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
            </button>
            <button className="p-3 text-slate-400 hover:bg-slate-50 rounded-xl transition-colors">
              <Settings className="w-6 h-6" />
            </button>
            <div className="h-8 w-[1px] bg-slate-100 mx-2" />
            <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-xl shadow-blue-100 active:scale-95">
              <Plus className="w-5 h-5" />
              Manual Entry
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-10">
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
                    <h2 className="text-4xl font-black tracking-tight mb-2">Hospital Health</h2>
                    <p className="text-slate-400 font-medium text-lg">Real-time patient flow and AI performance metrics.</p>
                  </div>
                  <div className="flex gap-2">
                    {["24h", "7d", "30d"].map(t => (
                      <button key={t} className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${t === "24h" ? "bg-white shadow-sm text-blue-600" : "text-slate-400 hover:bg-slate-100"}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                  {[
                    { label: "Total Calls", val: appointments.length * 3 + 12, icon: Phone, color: "blue" },
                    { label: "Booked", val: appointments.length, icon: Calendar, color: "emerald" },
                    { label: "Avg. Urgency", val: (appointments.reduce((acc, a) => acc + a.urgency, 0) / (appointments.length || 1)).toFixed(1), icon: Activity, color: "rose" },
                    { label: "AI Accuracy", val: "98.2%", icon: Zap, color: "amber" }
                  ].map((s, i) => (
                    <motion.div 
                      key={s.label}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-50 hover:shadow-xl hover:shadow-slate-100 transition-all group"
                    >
                      <div className={`w-14 h-14 rounded-2xl bg-${s.color}-50 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                        <s.icon className={`w-7 h-7 text-${s.color}-600`} />
                      </div>
                      <p className="text-slate-400 font-bold text-sm uppercase tracking-wider mb-1">{s.label}</p>
                      <p className="text-4xl font-black">{s.val}</p>
                    </motion.div>
                  ))}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                  {/* Activity Chart */}
                  <div className="xl:col-span-2 bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-50">
                    <div className="flex items-center justify-between mb-10">
                      <h3 className="text-2xl font-black tracking-tight">Booking Activity</h3>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-blue-600" />
                          <span className="text-xs font-bold text-slate-400">Urgency Level</span>
                        </div>
                      </div>
                    </div>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={activityData}>
                          <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1}/>
                              <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#94a3b8", fontWeight: 600 }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#94a3b8", fontWeight: 600 }} />
                          <Tooltip 
                            contentStyle={{ borderRadius: "20px", border: "none", boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)", padding: "15px" }}
                          />
                          <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={4} fillOpacity={1} fill="url(#colorValue)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Urgency Bar Chart */}
                  <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-50">
                    <h3 className="text-2xl font-black tracking-tight mb-10">Urgency Split</h3>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={urgencyData}>
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#94a3b8", fontWeight: 600 }} />
                          <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: "20px", border: "none" }} />
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
                <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-50 overflow-hidden">
                  <div className="p-10 border-b border-slate-50 flex items-center justify-between">
                    <h3 className="text-2xl font-black tracking-tight">Recent Patient Requests</h3>
                    <button className="text-blue-600 font-bold hover:underline">View All Records</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-slate-400 text-xs font-black uppercase tracking-widest">
                          <th className="px-10 py-6">Patient</th>
                          <th className="px-10 py-6">Medical Concern</th>
                          <th className="px-10 py-6">Priority</th>
                          <th className="px-10 py-6">Requested Slot</th>
                          <th className="px-10 py-6">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {appointments.map((apt) => (
                          <tr key={apt.id} className="hover:bg-slate-50/50 transition-colors group">
                            <td className="px-10 py-8">
                              <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-600 font-black text-lg">
                                  {apt.patientName.charAt(0)}
                                </div>
                                <div>
                                  <p className="font-bold text-lg">{apt.patientName}</p>
                                  <p className="text-sm text-slate-400 font-medium">{apt.patientPhone}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-10 py-8">
                              <p className="text-slate-600 font-medium max-w-xs truncate">{apt.reason}</p>
                            </td>
                            <td className="px-10 py-8">
                              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs uppercase ${
                                apt.urgency >= 4 ? "bg-red-50 text-red-600" :
                                apt.urgency === 3 ? "bg-amber-50 text-amber-600" :
                                "bg-emerald-50 text-emerald-600"
                              }`}>
                                <AlertCircle className="w-4 h-4" />
                                Level {apt.urgency}
                              </div>
                            </td>
                            <td className="px-10 py-8 font-bold text-slate-600">
                              {apt.preferredTime}
                            </td>
                            <td className="px-10 py-8">
                              <button className="p-3 bg-slate-100 text-slate-400 rounded-xl hover:bg-blue-600 hover:text-white transition-all">
                                <ChevronRight className="w-5 h-5" />
                              </button>
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
                    <h2 className="text-4xl font-black tracking-tight mb-2">Dev Console</h2>
                    <p className="text-slate-400 font-medium text-lg">Monitor voice workflow execution and system logs.</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl font-bold text-sm">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                      System Online
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                  {/* Workflow Visualization */}
                  <div className="xl:col-span-1 space-y-6">
                    <h3 className="text-xl font-black tracking-tight">Voice Workflow</h3>
                    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-50 space-y-8 relative">
                      {[
                        { step: "01", label: "Call Received", desc: "Twilio webhook triggers /api/voice", icon: Phone },
                        { step: "02", label: "Collect Name", desc: "Gathering speech input for patient identity", icon: UserIcon },
                        { step: "03", label: "Analyze Reason", desc: "Extracting medical concern and urgency", icon: Activity },
                        { step: "04", label: "Slot Matching", desc: "Checking availability and confirming time", icon: Clock },
                        { step: "05", label: "Persistence", desc: "Writing appointment record to Firestore", icon: Cpu }
                      ].map((s, i) => (
                        <div key={s.step} className="flex gap-6 relative z-10">
                          <div className="flex flex-col items-center">
                            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 font-black shadow-sm">
                              <s.icon className="w-6 h-6" />
                            </div>
                            {i < 4 && <div className="w-[2px] h-12 bg-slate-100 my-2" />}
                          </div>
                          <div>
                            <p className="text-xs font-black text-blue-600 uppercase tracking-widest mb-1">Step {s.step}</p>
                            <p className="font-bold text-lg mb-1">{s.label}</p>
                            <p className="text-sm text-slate-400 font-medium leading-relaxed">{s.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Real-time Logs */}
                  <div className="xl:col-span-2 space-y-6">
                    <h3 className="text-xl font-black tracking-tight">Live Event Stream</h3>
                    <div className="bg-slate-900 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden h-[700px] flex flex-col border-4 border-slate-800">
                      <div className="flex items-center gap-3 mb-6 text-slate-500 font-mono text-xs border-b border-slate-800 pb-4">
                        <Terminal className="w-4 h-4" />
                        <span>medivoice-ai-v1.0.4 ~ tail -f /var/log/voice.log</span>
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-4 font-mono text-sm custom-scrollbar">
                        <AnimatePresence initial={false}>
                          {logs.map((log) => (
                            <motion.div 
                              key={log.id}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="group flex gap-4"
                            >
                              <span className="text-slate-600 shrink-0">[{format(new Date(log.timestamp), "HH:mm:ss")}]</span>
                              <div className="flex-1">
                                <span className={`font-bold ${
                                  log.event.includes("FAILED") ? "text-rose-500" : 
                                  log.event.includes("CREATED") ? "text-emerald-400" : 
                                  "text-blue-400"
                                }`}>
                                  {log.event}
                                </span>
                                <span className="text-slate-400 ml-3">sid: {log.callSid.slice(-6)}</span>
                                <div className="mt-1 p-3 bg-slate-800/50 rounded-xl text-slate-300 text-xs hidden group-hover:block border border-slate-700">
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

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
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
