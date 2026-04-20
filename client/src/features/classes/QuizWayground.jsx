import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../../store/authStore';
import { io } from 'socket.io-client';
import { SOCKET_OPTIONS, SOCKET_URL, getRealtimeConfigHint, warmupRealtimeEndpoint } from '../../shared/config/realtime';
import {
  Users, Play, ChevronRight, Trophy,
  Wifi, WifiOff, Clock, Check, Hash,
  AlertCircle, Flag, Maximize2, Minimize2
} from 'lucide-react';

export default function QuizWayground({ quiz, onDone }) {
  const { user, profile } = useAuthStore();
  const isTeacher = profile?.role === 'teacher';

  return isTeacher
    ? <TeacherWayground quiz={quiz} user={user} onDone={onDone} />
    : <StudentWayground quiz={quiz} user={user} profile={profile} onDone={onDone} />;
}

// ─────────────────────────────────────────────
// TEACHER WAYGROUND
// ─────────────────────────────────────────────
function TeacherWayground({ quiz, user, onDone }) {
  const socketRef = useRef(null);
  const [code, setCode] = useState(quiz.join_code || '');
  const [socketError, setSocketError] = useState('');
  const [isFullscreenUI, setIsFullscreenUI] = useState(false);
  const [students, setStudents] = useState([]);
  const [phase, setPhase] = useState('boarding'); // boarding | active | ended
  const [currentQ, setCurrentQ] = useState(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [totalQ, setTotalQ] = useState(0);
  const [results, setResults] = useState(null);
  const [questionTimeLimitSec, setQuestionTimeLimitSec] = useState(30);
  const [lateJoinPolicyCurrentOnly, setLateJoinPolicyCurrentOnly] = useState(true);
  const [questionEndsAt, setQuestionEndsAt] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const timerRef = useRef(null);
  const questionTimeLimitRef = useRef(questionTimeLimitSec);
  const lateJoinPolicyRef = useRef(lateJoinPolicyCurrentOnly);

  useEffect(() => {
    questionTimeLimitRef.current = questionTimeLimitSec;
  }, [questionTimeLimitSec]);

  useEffect(() => {
    lateJoinPolicyRef.current = lateJoinPolicyCurrentOnly;
  }, [lateJoinPolicyCurrentOnly]);

  useEffect(() => {
    let disposed = false;

    const setupSocket = async () => {
      await warmupRealtimeEndpoint({ attempts: 3 });

      if (disposed) return;

      const socket = io(SOCKET_URL, SOCKET_OPTIONS);
      socketRef.current = socket;

      const emitTeacherInitRoom = () => {
        socket.emit('teacher-init-room', {
          quizId: quiz.id,
          teacherId: user.id,
          questionTimeLimitSec: questionTimeLimitRef.current,
          lateJoinPolicyCurrentOnly: lateJoinPolicyRef.current,
        });
      };

      socket.on('connect', () => {
        setSocketError('');
        emitTeacherInitRoom();
      });

      socket.on('disconnect', (reason) => {
        if (reason === 'io client disconnect') return;
        setSocketError('Quiz room connection lost. Reconnecting...');
      });

      socket.on('connect_error', () => {
        setSocketError('Connecting to quiz room...');
      });

      socket.io.on('reconnect_attempt', () => {
        setSocketError('Reconnecting to quiz room...');
      });

      socket.io.on('reconnect', () => {
        setSocketError('');
        emitTeacherInitRoom();
      });

      socket.io.on('reconnect_failed', () => {
        setSocketError(getRealtimeConfigHint('Quiz room connection'));
      });

      socket.on('quiz-error', ({ message }) => {
        setSocketError(message || getRealtimeConfigHint('Quiz room connection'));
      });

      socket.on('room-ready', ({ code: c, students: s, questionTimeLimitSec: t, lateJoinPolicyCurrentOnly: policy }) => {
        setSocketError('');
        setCode(c);
        setStudents(s);
        if (t) setQuestionTimeLimitSec(t);
        if (typeof policy === 'boolean') setLateJoinPolicyCurrentOnly(policy);
      });

      socket.on('room-settings-updated', ({ questionTimeLimitSec: t, lateJoinPolicyCurrentOnly: policy }) => {
        if (t) setQuestionTimeLimitSec(t);
        if (typeof policy === 'boolean') setLateJoinPolicyCurrentOnly(policy);
      });

      socket.on('question-timer-sync', ({ questionEndsAt: endsAt, questionTimeLimitSec: t }) => {
        setQuestionEndsAt(endsAt || null);
        setTimeLeft(endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null);
        if (t) setQuestionTimeLimitSec(t);
      });

      socket.on('student-list-update', ({ students: s }) => setStudents(s));

      socket.on('quiz-started', ({ question, index, total, questionEndsAt: endsAt }) => {
        setCurrentQ(question);
        setCurrentIdx(index);
        setTotalQ(total);
        setQuestionEndsAt(endsAt || null);
        setTimeLeft(endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null);
        setPhase('active');
      });

      socket.on('question-start', ({ question, index, total, questionEndsAt: endsAt }) => {
        setCurrentQ(question);
        setCurrentIdx(index);
        setTotalQ(total);
        setQuestionEndsAt(endsAt || null);
        setTimeLeft(endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null);
      });

      socket.on('quiz-ended', () => {
        setPhase('ended');
        setQuestionEndsAt(null);
        setTimeLeft(null);
      });

      socket.on('results-revealed', ({ results: r }) => setResults(r));
    };

    setupSocket();

    return () => {
      disposed = true;
      clearInterval(timerRef.current);
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [quiz.id, user.id]);

  useEffect(() => {
    clearInterval(timerRef.current);
    if (!questionEndsAt || phase !== 'active') {
      setTimeLeft(null);
      return;
    }

    const update = () => {
      const seconds = Math.max(0, Math.ceil((questionEndsAt - Date.now()) / 1000));
      setTimeLeft(seconds);
    };

    update();
    timerRef.current = setInterval(update, 500);
    return () => clearInterval(timerRef.current);
  }, [questionEndsAt, phase]);

  function startQuiz() {
    socketRef.current?.emit('start-quiz', {
      quizId: quiz.id,
      questionTimeLimitSec,
      lateJoinPolicyCurrentOnly,
    });
  }

  function pushSettings(next = {}) {
    socketRef.current?.emit('teacher-update-room-settings', {
      quizId: quiz.id,
      questionTimeLimitSec: next.questionTimeLimitSec ?? questionTimeLimitSec,
      lateJoinPolicyCurrentOnly: next.lateJoinPolicyCurrentOnly ?? lateJoinPolicyCurrentOnly,
    });
  }

  function nextQuestion() {
    socketRef.current?.emit('next-question', { quizId: quiz.id });
  }

  function revealResults() {
    socketRef.current?.emit('reveal-results', { quizId: quiz.id });
  }

  function endQuiz() {
    if (!confirm('End the quiz now?')) return;
    socketRef.current?.emit('end-quiz', { quizId: quiz.id });
  }

  const toggleFullscreenUI = () => {
    setIsFullscreenUI((prev) => !prev);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsFullscreenUI(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const shellClass = isFullscreenUI
    ? 'fixed inset-0 z-50 bg-slate-950 p-4 md:p-6 overflow-auto'
    : '';

  // BOARDING
  if (phase === 'boarding') {
    return (
      <div className={shellClass}>
        <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-xl font-bold ${isFullscreenUI ? 'text-white' : 'text-gray-900'}`}>{quiz.title}</h2>
            <p className={`text-sm mt-0.5 ${isFullscreenUI ? 'text-slate-300' : 'text-gray-500'}`}>Waiting for students to join...</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleFullscreenUI}
              className={`px-3 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${isFullscreenUI ? 'bg-slate-700 text-slate-100 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {isFullscreenUI ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              {isFullscreenUI ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
            <button onClick={onDone} className={`text-sm px-4 py-2 rounded-xl transition-all ${isFullscreenUI ? 'text-slate-200 hover:bg-slate-800' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}>Exit</button>
          </div>
        </div>

        {/* Join Code */}
        <div className="bg-gradient-to-br from-primary to-primary-dark rounded-2xl p-8 text-center text-white shadow-xl">
          <p className="text-sm font-medium opacity-80 mb-2">Quiz Join Code</p>
          {socketError && (
            <div className="mb-4 rounded-xl border border-red-300 bg-red-50/95 px-3 py-2 text-xs text-red-700 inline-flex items-center gap-2">
              <AlertCircle size={13} />
              {socketError}
            </div>
          )}
          <div className="flex items-center justify-center gap-3 mb-2">
            <Hash size={28} className="opacity-70" />
            <span className="text-6xl font-black tracking-widest font-mono">{code || '------'}</span>
          </div>
          <p className="text-sm opacity-70">Students enter this code to join</p>
        </div>

        {/* Student List */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <Users size={18} className="text-primary" />
              Joined Students ({students.length})
            </h3>
          </div>
          {students.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Users size={36} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">Waiting for students...</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {students.map(s => (
                <div key={s.studentId} className="flex items-center gap-2.5 p-3 bg-gray-50 rounded-xl">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {s.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{s.name}</p>
                    <span className={`text-xs flex items-center gap-1 ${s.connected ? 'text-green-500' : 'text-gray-400'}`}>
                      {s.connected ? <Wifi size={10} /> : <WifiOff size={10} />}
                      {s.connected ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <h3 className="font-semibold text-gray-800">Live Quiz Controls</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Timer per Question (seconds)</label>
              <input
                type="number"
                min={5}
                max={600}
                value={questionTimeLimitSec}
                onChange={(e) => {
                  const val = Math.max(5, Math.min(600, parseInt(e.target.value || '30', 10)));
                  setQuestionTimeLimitSec(val);
                  pushSettings({ questionTimeLimitSec: val });
                }}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700 font-medium">
                <input
                  type="checkbox"
                  checked={lateJoinPolicyCurrentOnly}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setLateJoinPolicyCurrentOnly(val);
                    pushSettings({ lateJoinPolicyCurrentOnly: val });
                  }}
                  className="rounded border-gray-300"
                />
                Allow late joiners to start at current question
              </label>
            </div>
          </div>
        </div>

        <button
          onClick={startQuiz}
          disabled={students.length === 0}
          className="w-full py-4 bg-primary text-white rounded-2xl font-bold text-lg hover:bg-primary-dark transition-all shadow-lg disabled:opacity-40 flex items-center justify-center gap-3"
        >
          <Play size={22} /> Start Quiz ({students.length} student{students.length !== 1 ? 's' : ''})
        </button>
        </div>
      </div>
    );
  }

  // ACTIVE
  if (phase === 'active') {
    const answeredCount = students.filter(s => s.answeredCount > currentIdx).length;

    return (
      <div className={shellClass}>
        <div className="space-y-6">
        {/* Progress */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900">{quiz.title}</h2>
            <div className="flex items-center gap-3">
              {timeLeft !== null && (
                <span className={`text-sm font-mono font-bold ${timeLeft <= 5 ? 'text-red-500' : 'text-primary'}`}>
                  {formatTime(timeLeft)}
                </span>
              )}
              <span className="text-sm text-gray-500">Question {currentIdx + 1} of {totalQ}</span>
              <button onClick={endQuiz} className="text-xs text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1">
                <Flag size={13} /> End Quiz
              </button>
              <button
                onClick={toggleFullscreenUI}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${isFullscreenUI ? 'bg-slate-700 text-slate-100 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {isFullscreenUI ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                {isFullscreenUI ? 'Exit Fullscreen' : 'Fullscreen'}
              </button>
            </div>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((currentIdx + 1) / totalQ) * 100}%` }} />
          </div>
        </div>

        {/* Current Question */}
        {currentQ && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold bg-primary text-white px-2.5 py-1 rounded-full uppercase">
                {currentQ.question_type?.replace('_', ' ')}
              </span>
              <span className="text-xs text-gray-400">{currentQ.points} pt{currentQ.points !== 1 ? 's' : ''}</span>
            </div>
            {currentQ.code_snippet && (
              <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-sm font-mono overflow-x-auto whitespace-pre-wrap">{currentQ.code_snippet}</pre>
            )}
            <p className="text-lg font-semibold text-gray-900">{currentQ.question}</p>
            {currentQ.options?.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {currentQ.options.map((opt, i) => (
                  <div key={i} className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-sm text-gray-700">
                    <span className="font-bold text-primary mr-2">{['A', 'B', 'C', 'D'][i]}.</span>{opt}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Live Student Status */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <Users size={18} className="text-primary" />
              Students ({answeredCount}/{students.length} answered)
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {students.map(s => {
              const answered = s.answeredCount > currentIdx;
              return (
                <div key={s.studentId} className={`flex items-center gap-2.5 p-3 rounded-xl border-2 transition-all ${answered ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${answered ? 'bg-green-500' : 'bg-gray-400'}`}>
                    {answered ? <Check size={14} /> : s.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{s.name}</p>
                    <span className={`text-xs flex items-center gap-1 ${s.connected ? 'text-green-500' : 'text-red-400'}`}>
                      {s.connected ? <Wifi size={10} /> : <WifiOff size={10} />}
                      {answered ? 'Answered' : s.connected ? 'Thinking...' : 'Disconnected'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <button
          onClick={nextQuestion}
          className="w-full py-4 bg-primary text-white rounded-2xl font-bold text-lg hover:bg-primary-dark transition-all shadow-lg flex items-center justify-center gap-3"
        >
          {currentIdx + 1 >= totalQ ? (
            <><Flag size={22} /> End Quiz & Save Results</>
          ) : (
            <><ChevronRight size={22} /> Next Question</>
          )}
        </button>
        </div>
      </div>
    );
  }

  // ENDED
  return (
    <div className={shellClass}>
      <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={toggleFullscreenUI}
          className={`px-3 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${isFullscreenUI ? 'bg-slate-700 text-slate-100 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          {isFullscreenUI ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          {isFullscreenUI ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      </div>
      <div className="text-center py-8">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <Check size={36} className="text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">Quiz Ended</h2>
        <p className="text-gray-500 mt-1">All answers saved. Reveal results when ready.</p>
      </div>

      {results ? (
        <ResultsTable results={results} />
      ) : (
        <button
          onClick={revealResults}
          className="w-full py-4 bg-primary text-white rounded-2xl font-bold text-lg hover:bg-primary-dark transition-all shadow-lg flex items-center justify-center gap-3"
        >
          <Trophy size={22} /> Reveal Rankings & Results
        </button>
      )}

      <button onClick={onDone} className="w-full py-3 border-2 border-gray-200 rounded-2xl font-semibold text-gray-600 hover:bg-gray-50 transition-all">
        Back to Quizzes
      </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// STUDENT WAYGROUND
// ─────────────────────────────────────────────
function StudentWayground({ quiz, user, profile, onDone }) {
  const socketRef = useRef(null);
  const [isFullscreenUI, setIsFullscreenUI] = useState(false);
  const [phase, setPhase] = useState('joining'); // joining | waiting | active | ended | results
  const [error, setError] = useState('');
  const [currentQ, setCurrentQ] = useState(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [totalQ, setTotalQ] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState(null);
  const [draftAnswer, setDraftAnswer] = useState('');
  const [timeLeft, setTimeLeft] = useState(null);
  const [questionEndsAt, setQuestionEndsAt] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    let disposed = false;

    const setupSocket = async () => {
      await warmupRealtimeEndpoint({ attempts: 3 });

      if (disposed) return;

      const socket = io(SOCKET_URL, SOCKET_OPTIONS);
      socketRef.current = socket;

      const emitStudentJoin = () => {
        socket.emit('student-join', {
          code: quiz.join_code,
          studentId: user.id,
          studentName: profile?.full_name || 'Student',
        });
      };

      socket.on('connect', () => {
        setError('');
        emitStudentJoin();
      });

      socket.on('disconnect', (reason) => {
        if (reason === 'io client disconnect') return;
        setError('Connection lost. Reconnecting to quiz room...');
        setPhase('joining');
      });

      socket.on('connect_error', () => {
        setError('Connecting to quiz room...');
        setPhase('joining');
      });

      socket.io.on('reconnect_attempt', () => {
        setError('Reconnecting to quiz room...');
        setPhase('joining');
      });

      socket.io.on('reconnect', () => {
        setError('');
        emitStudentJoin();
      });

      socket.io.on('reconnect_failed', () => {
        setError(getRealtimeConfigHint('Quiz room connection'));
        setPhase('joining');
      });

      socket.on('quiz-error', ({ message }) => {
        setError(message || getRealtimeConfigHint('Quiz room connection'));
      });

      socket.on('joined-waiting', () => {
        setError('');
        setPhase('waiting');
      });
      socket.on('join-error', ({ message }) => { setError(message); setPhase('joining'); });

      socket.on('quiz-started', ({ question, index, total, questionEndsAt: endsAt }) => {
        setError('');
        setCurrentQ(question);
        setCurrentIdx(index);
        setTotalQ(total);
        setSubmitted(false);
        setDraftAnswer('');
        setQuestionEndsAt(endsAt || null);
        setTimeLeft(endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null);
        setPhase('active');
      });

      socket.on('question-start', ({ question, index, total, questionEndsAt: endsAt }) => {
        setCurrentQ(question);
        setCurrentIdx(index);
        setTotalQ(total);
        setSubmitted(false);
        setDraftAnswer('');
        setQuestionEndsAt(endsAt || null);
        setTimeLeft(endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null);
      });

      socket.on('question-timer-sync', ({ questionEndsAt: endsAt }) => {
        setQuestionEndsAt(endsAt || null);
        setTimeLeft(endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null);
      });

      socket.on('submit-rejected', ({ message }) => {
        setSubmitted(false);
        setError(message || 'Answer not accepted.');
      });

      socket.on('quiz-ended', () => {
        setPhase('ended');
        setQuestionEndsAt(null);
        setTimeLeft(null);
      });
      socket.on('results-revealed', ({ results: r }) => { setResults(r); setPhase('results'); });

    };

    setupSocket();

    return () => {
      disposed = true;
      clearInterval(timerRef.current);
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [quiz.id, quiz.join_code, quiz.status, user.id, profile?.full_name]);

  useEffect(() => {
    clearInterval(timerRef.current);
    if (!questionEndsAt || phase !== 'active') {
      setTimeLeft(null);
      return;
    }

    const update = () => {
      const seconds = Math.max(0, Math.ceil((questionEndsAt - Date.now()) / 1000));
      setTimeLeft(seconds);
    };

    update();
    timerRef.current = setInterval(update, 500);
    return () => clearInterval(timerRef.current);
  }, [questionEndsAt, phase]);

  function joinWithCode(code) {
    setError('');
    socketRef.current?.emit('student-join', {
      code: code.trim().toUpperCase(),
      studentId: user.id,
      studentName: profile?.full_name || 'Student',
    });
  }

  function submitAnswer(answer) {
    if (submitted) return;
    if (!currentQ) return;
    const finalAnswer = `${answer ?? ''}`;
    const isChoiceQuestion = currentQ.question_type === 'multiple_choice' || currentQ.question_type === 'true_false';
    if (!isChoiceQuestion && !finalAnswer.trim()) return;

    setAnswers(prev => ({ ...prev, [currentQ.id]: finalAnswer }));
    socketRef.current?.emit('submit-answer', {
      quizId: quiz.id,
      questionId: currentQ.id,
      answer: finalAnswer,
    });
    setSubmitted(true);
  }

  const toggleFullscreenUI = () => {
    setIsFullscreenUI((prev) => !prev);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsFullscreenUI(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const shellClass = isFullscreenUI
    ? 'fixed inset-0 z-50 bg-slate-950 p-4 md:p-6 overflow-auto'
    : '';

  // JOINING
  if (phase === 'joining') {
    return (
      <div className={shellClass}>
        <div className="flex justify-end mb-4">
          <button
            onClick={toggleFullscreenUI}
            className={`px-3 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${isFullscreenUI ? 'bg-slate-700 text-slate-100 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {isFullscreenUI ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {isFullscreenUI ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
        <JoinScreen onJoin={joinWithCode} error={error} defaultCode={quiz.join_code} />
      </div>
    );
  }

  // WAITING
  if (phase === 'waiting') {
    return (
      <div className={shellClass}>
        <div className="flex justify-end mb-4">
          <button
            onClick={toggleFullscreenUI}
            className={`px-3 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${isFullscreenUI ? 'bg-slate-700 text-slate-100 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {isFullscreenUI ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {isFullscreenUI ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
        <div className="flex flex-col items-center justify-center py-20 space-y-6">
        <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">You're in!</h2>
          <p className="text-gray-500 mt-1">Waiting for the teacher to start the quiz...</p>
        </div>
        <div className="bg-surface border border-blue-100 rounded-2xl px-8 py-4 text-center">
          <p className="text-sm text-gray-500">Quiz</p>
          <p className="text-lg font-bold text-gray-900">{quiz.title}</p>
        </div>
        </div>
      </div>
    );
  }

  // ACTIVE
  if (phase === 'active' && currentQ) {
    const progress = ((currentIdx + 1) / totalQ) * 100;
    const isLocked = timeLeft !== null && timeLeft <= 0;

    return (
      <div className={shellClass}>
      <div className="space-y-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700">Question {currentIdx + 1} of {totalQ}</span>
            <div className="flex items-center gap-2">
              {timeLeft !== null && (
                <span className={`text-sm font-mono font-bold ${timeLeft <= 5 ? 'text-red-500' : 'text-primary'}`}>{formatTime(timeLeft)}</span>
              )}
              <button
                onClick={toggleFullscreenUI}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${isFullscreenUI ? 'bg-slate-700 text-slate-100 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {isFullscreenUI ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                {isFullscreenUI ? 'Exit Fullscreen' : 'Fullscreen'}
              </button>
            </div>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Question Card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold bg-primary text-white px-2.5 py-1 rounded-full uppercase">
              {currentQ.question_type?.replace('_', ' ')}
            </span>
            <span className="text-xs text-gray-400">{currentQ.points} pt{currentQ.points !== 1 ? 's' : ''}</span>
          </div>

          {currentQ.code_snippet && (
            <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-sm font-mono overflow-x-auto whitespace-pre-wrap">{currentQ.code_snippet}</pre>
          )}

          <p className="text-lg font-semibold text-gray-900 leading-relaxed">{currentQ.question}</p>

          {isLocked && !submitted && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 px-4 py-3 rounded-xl">
              <AlertCircle size={18} />
              <span className="text-sm font-semibold">Time is up for this question. Waiting for next question...</span>
            </div>
          )}

          {/* Multiple Choice */}
          {currentQ.question_type === 'multiple_choice' && (
            <div className="space-y-3">
              {['A', 'B', 'C', 'D'].map((letter, i) => (
                <button
                  key={letter}
                  onClick={() => !submitted && !isLocked && setDraftAnswer(letter)}
                  disabled={submitted || isLocked}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                    (submitted ? answers[currentQ.id] : draftAnswer) === letter
                      ? 'border-primary bg-blue-50'
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  } disabled:cursor-not-allowed`}
                >
                  <span className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    (submitted ? answers[currentQ.id] : draftAnswer) === letter ? 'border-primary bg-primary text-white' : 'border-gray-300 text-gray-500'
                  }`}>{letter}</span>
                  <span className="text-sm text-gray-800">{currentQ.options?.[i]}</span>
                </button>
              ))}
              {!submitted && (
                <button
                  onClick={() => submitAnswer(draftAnswer)}
                  disabled={!draftAnswer || isLocked}
                  className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark transition-all disabled:opacity-40"
                >
                  Confirm Final Answer
                </button>
              )}
            </div>
          )}

          {/* True or False */}
          {currentQ.question_type === 'true_false' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                {['True', 'False'].map(val => (
                  <button
                    key={val}
                    onClick={() => !submitted && !isLocked && setDraftAnswer(val)}
                    disabled={submitted || isLocked}
                    className={`py-4 rounded-xl border-2 font-bold text-lg transition-all ${
                      (submitted ? answers[currentQ.id] : draftAnswer) === val
                        ? 'border-primary bg-blue-50 text-primary'
                        : 'border-gray-100 text-gray-600 hover:border-gray-300'
                    } disabled:cursor-not-allowed`}
                  >
                    {val}
                  </button>
                ))}
              </div>
              {!submitted && (
                <button
                  onClick={() => submitAnswer(draftAnswer)}
                  disabled={!draftAnswer || isLocked}
                  className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark transition-all disabled:opacity-40"
                >
                  Confirm Final Answer
                </button>
              )}
            </div>
          )}

          {/* Identification */}
          {currentQ.question_type === 'identification' && (
            <div className="space-y-3">
              <input
                value={draftAnswer}
                onChange={e => setDraftAnswer(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !submitted && submitAnswer(draftAnswer)}
                disabled={submitted || isLocked}
                placeholder="Type your answer..."
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-400">Answer is not case-sensitive.</p>
              {!submitted && (
                <button
                  onClick={() => submitAnswer(draftAnswer)}
                  disabled={!draftAnswer.trim() || isLocked}
                  className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark transition-all disabled:opacity-40"
                >
                  Confirm Final Answer
                </button>
              )}
            </div>
          )}

          {/* Trace the Error */}
          {currentQ.question_type === 'trace_error' && (
            <div className="space-y-3">
              <input
                value={draftAnswer}
                onChange={e => setDraftAnswer(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !submitted && submitAnswer(draftAnswer)}
                disabled={submitted || isLocked}
                placeholder="Type exact answer (case-sensitive)..."
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all disabled:bg-gray-50"
              />
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle size={12} /> Exact match required — spelling, capitalization, and spaces all matter.
              </p>
              {!submitted && (
                <button
                  onClick={() => submitAnswer(draftAnswer)}
                  disabled={!draftAnswer.trim() || isLocked}
                  className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark transition-all disabled:opacity-40"
                >
                  Confirm Final Answer
                </button>
              )}
            </div>
          )}

          {submitted && (
            <div className="flex items-center gap-2 text-green-600 bg-green-50 px-4 py-3 rounded-xl">
              <Check size={18} />
              <span className="text-sm font-semibold">Answer submitted! Waiting for next question...</span>
            </div>
          )}
        </div>
      </div>
      </div>
    );
  }

  // ENDED - waiting for results
  if (phase === 'ended') {
    return (
      <div className={shellClass}>
        <div className="flex justify-end mb-4">
          <button
            onClick={toggleFullscreenUI}
            className={`px-3 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${isFullscreenUI ? 'bg-slate-700 text-slate-100 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {isFullscreenUI ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {isFullscreenUI ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
        <div className="flex flex-col items-center justify-center py-20 space-y-6">
        <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center">
          <Trophy size={36} className="text-primary" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">Quiz Complete!</h2>
          <p className="text-gray-500 mt-1">Waiting for teacher to reveal results...</p>
        </div>
        </div>
      </div>
    );
  }

  // RESULTS
  if (phase === 'results' && results) {
    const myResult = results.find(r => r.student_id === user.id);
    const myRank = results.findIndex(r => r.student_id === user.id) + 1;
    const pct = myResult?.total_points ? Math.round((myResult.score / myResult.total_points) * 100) : 0;

    return (
      <div className={shellClass}>
        <div className="flex justify-end mb-4 max-w-2xl mx-auto">
          <button
            onClick={toggleFullscreenUI}
            className={`px-3 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${isFullscreenUI ? 'bg-slate-700 text-slate-100 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {isFullscreenUI ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {isFullscreenUI ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
        <div className="space-y-6 max-w-2xl mx-auto">
        {/* My Score */}
        <div className={`rounded-2xl p-8 text-center text-white shadow-xl ${pct >= 75 ? 'bg-gradient-to-br from-green-500 to-green-600' : pct >= 50 ? 'bg-gradient-to-br from-yellow-500 to-orange-500' : 'bg-gradient-to-br from-red-500 to-red-600'}`}>
          <p className="text-sm font-medium opacity-80 mb-1">Your Score</p>
          <p className="text-6xl font-black">{pct}%</p>
          <p className="opacity-90 mt-1">{myResult?.score}/{myResult?.total_points} points · Rank #{myRank}</p>
        </div>

        <ResultsTable results={results} highlightId={user.id} />

        <button onClick={onDone} className="w-full py-3 border-2 border-gray-200 rounded-2xl font-semibold text-gray-600 hover:bg-gray-50 transition-all">
          Back to Quizzes
        </button>
        </div>
      </div>
    );
  }

  return null;
}

// ─────────────────────────────────────────────
// JOIN SCREEN
// ─────────────────────────────────────────────
function JoinScreen({ onJoin, error, defaultCode }) {
  const [code, setCode] = useState(defaultCode || '');

  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-6 max-w-sm mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
        <Hash size={30} className="text-white" />
      </div>
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900">Join Quiz</h2>
        <p className="text-gray-500 mt-1 text-sm">Enter the code given by your teacher</p>
      </div>
      <div className="w-full space-y-3">
        <input
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && onJoin(code)}
          placeholder="XXXXXX"
          maxLength={6}
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-center text-3xl font-mono font-bold tracking-widest focus:outline-none focus:border-primary transition-all uppercase"
        />
        {error && (
          <p className="text-sm text-red-500 flex items-center gap-1.5 justify-center">
            <AlertCircle size={14} /> {error}
          </p>
        )}
        <button
          onClick={() => onJoin(code)}
          disabled={code.length < 6}
          className="w-full py-3 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-all shadow-md disabled:opacity-40"
        >
          Join
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// RESULTS TABLE (shared)
// ─────────────────────────────────────────────
function ResultsTable({ results, highlightId }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
        <Trophy size={18} className="text-yellow-500" />
        <h3 className="font-bold text-gray-900">Rankings</h3>
      </div>
      <div className="divide-y divide-gray-50">
        {results.map((r, idx) => {
          const pct = r.total_points ? Math.round((r.score / r.total_points) * 100) : 0;
          const isMe = r.student_id === highlightId;
          return (
            <div key={r.id} className={`flex items-center gap-4 px-6 py-4 transition-colors ${isMe ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${
                idx === 0 ? 'bg-yellow-400' : idx === 1 ? 'bg-gray-400' : idx === 2 ? 'bg-orange-400' : 'bg-blue-200 text-blue-700'
              }`}>{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold truncate ${isMe ? 'text-primary' : 'text-gray-900'}`}>
                  {r.student_name || r.profiles?.full_name || 'Unknown'} {isMe && '(You)'}
                </p>
                {r.profiles?.student_id && <p className="text-xs text-gray-400">{r.profiles.student_id}</p>}
              </div>
              <div className="text-right">
                <p className="font-bold text-gray-900">{r.score}<span className="text-gray-400 font-normal">/{r.total_points}</span></p>
                <p className={`text-xs font-medium ${pct >= 75 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>{pct}%</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}