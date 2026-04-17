import { useState, useEffect } from 'react';
import { supabase } from '../../config/supabase';
import { useAuthStore } from '../../store/authStore';
import QuizEditor from './QuizEditor';
import QuizWayground from './QuizWayground';
import QuizMakeup from './QuizMakeup';
import QuizAnalytics from './QuizAnalytics';
import QuizResults from './QuizResults';
import { createClassNotification } from '../notifications/notificationService';
import {
  Plus, BookOpen, Clock, Calendar, Users,
  BarChart2, Edit3, Trash2, Play, FlaskConical,
  Hash, Eye, AlertCircle, RefreshCcw
} from 'lucide-react';

export default function QuizzesTab({ classId }) {
  const { user, profile } = useAuthStore();
  const isTeacher = profile?.role === 'teacher';

  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetchQuizzes();

    const channel = supabase
      .channel(`quizzes-tab-${classId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quizzes', filter: `class_id=eq.${classId}` }, fetchQuizzes)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_questions' }, fetchQuizzes)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_submissions' }, fetchQuizzes)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [classId]);

  async function fetchQuizzes() {
    setLoading(true);
    setError('');
    const { data, error: fetchError } = await supabase
      .from('quizzes')
      .select('*, quiz_questions(*), quiz_submissions(id, student_id, answers, score, total_points)')
      .eq('class_id', classId)
      .order('created_at', { ascending: false });
    if (fetchError) setError(fetchError.message || 'Unable to load quizzes right now. Please retry.');
    setQuizzes(data || []);
    setLoading(false);
  }

  function isCorrect(q, rawAnswer) {
    if (rawAnswer === null || rawAnswer === undefined) return false;
    const answer = `${rawAnswer}`;
    const correct = `${q.correct_answer ?? ''}`;
    if (q.question_type === 'trace_error') return answer === correct;
    return answer.trim().toUpperCase() === correct.trim().toUpperCase();
  }

  function computeSubmissionScore(quiz, submission) {
    const questions = quiz.quiz_questions || [];
    if (!questions.length) {
      return {
        score: submission?.score ?? 0,
        totalPoints: submission?.total_points ?? 0,
      };
    }

    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    const score = questions.reduce((sum, q) => {
      if (!isCorrect(q, submission?.answers?.[q.id])) return sum;
      return sum + (q.points || 1);
    }, 0);

    return { score, totalPoints };
  }

  async function deleteQuiz(id) {
    if (!confirm('Delete this quiz? This cannot be undone.')) return;
    await supabase.from('quizzes').delete().eq('id', id);
    fetchQuizzes();
  }

  async function publishQuiz(quiz) {
    const { error } = await supabase.from('quizzes').update({ is_published: true }).eq('id', quiz.id);

    if (!error && !quiz.is_published) {
      const { error: notificationError } = await createClassNotification({
        classId,
        actorId: profile?.id || null,
        type: 'quiz_published',
        title: 'New quiz published',
        body: quiz.title || 'A new quiz is now available.',
        targetPath: `/classes/${classId}?tab=Quizzes`,
        targetParams: { quizId: quiz.id },
        recipients: 'students',
      });

      if (notificationError) {
        console.warn('Quiz publish notification failed:', notificationError.message);
      }
    }

    fetchQuizzes();
  }

  function getStatusBadge(quiz) {
    if (!quiz.is_published) return { label: 'Draft', style: 'bg-gray-100 text-gray-600' };
    if (quiz.status === 'active') return { label: 'Live', style: 'bg-green-100 text-green-700 animate-pulse' };
    if (quiz.status === 'ended') return { label: 'Ended', style: 'bg-red-100 text-red-600' };
    if (quiz.status === 'waiting') return { label: 'Waiting', style: 'bg-yellow-100 text-yellow-700' };
    return { label: 'Published', style: 'bg-blue-100 text-blue-700' };
  }

  if (view === 'editor') return <QuizEditor classId={classId} quiz={selected} onDone={() => { setView('list'); fetchQuizzes(); }} onCancel={() => setView('list')} />;
  if (view === 'wayground') return <QuizWayground quiz={selected} onDone={() => { setView('list'); fetchQuizzes(); }} />;
  if (view === 'makeup') return <QuizMakeup quiz={selected} classId={classId} onBack={() => setView('list')} />;
  if (view === 'analytics') return <QuizAnalytics quiz={selected} onBack={() => setView('list')} />;
  if (view === 'results') return <QuizResults quiz={selected} onBack={() => setView('list')} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Quizzes</h2>
          <p className="text-sm text-gray-500 mt-0.5">{quizzes.length} quiz{quizzes.length !== 1 ? 'zes' : ''}</p>
        </div>
        {isTeacher && (
          <button
            onClick={() => { setSelected(null); setView('editor'); }}
            className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-dark transition-all shadow-md hover:shadow-lg"
          >
            <Plus size={18} /> New Quiz
          </button>
        )}
      </div>

      {/* Student: Join by code */}
      {!isTeacher && (
        <JoinByCode userId={user.id} onJoin={(quiz) => { setSelected(quiz); setView('wayground'); }} />
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="bg-white border border-gray-100 rounded-2xl p-6 animate-pulse">
              <div className="h-4 w-24 bg-gray-100 rounded mb-3" />
              <div className="h-5 w-1/2 bg-gray-100 rounded mb-2" />
              <div className="h-4 w-3/4 bg-gray-100 rounded mb-4" />
              <div className="h-4 w-1/3 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-red-700 inline-flex items-center gap-2"><AlertCircle size={16} /> {error}</p>
          <button
            onClick={fetchQuizzes}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-100"
          >
            <RefreshCcw size={13} /> Retry
          </button>
        </div>
      ) : quizzes.length === 0 ? (
        <div className="text-center py-20 bg-surface rounded-2xl border-2 border-dashed border-blue-200">
          <BookOpen size={48} className="mx-auto text-blue-300 mb-4" />
          <p className="text-gray-500 font-medium">No quizzes yet</p>
          {!isTeacher && <p className="text-sm text-gray-400 mt-1">Your teacher has not published any quizzes yet.</p>}
          {isTeacher && (
            <button onClick={() => { setSelected(null); setView('editor'); }} className="mt-4 text-primary font-semibold hover:underline">
              Create your first quiz
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {quizzes.map(quiz => {
            const badge = getStatusBadge(quiz);
            const qCount = quiz.quiz_questions?.length || 0;
            const subCount = quiz.quiz_submissions?.length || 0;
            const mySubmission = !isTeacher ? quiz.quiz_submissions?.find(s => s.student_id === user.id) : null;
            const computedMyScore = mySubmission ? computeSubmissionScore(quiz, mySubmission) : null;

            return (
              <div key={quiz.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md transition-all p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide ${badge.style}`}>
                        {badge.label}
                      </span>
                      {mySubmission && (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                          Score: {computedMyScore?.score ?? 0}/{computedMyScore?.totalPoints ?? 0}
                        </span>
                      )}
                      {quiz.join_code && isTeacher && (
                        <span className="flex items-center gap-1 text-xs font-mono bg-gray-100 px-2.5 py-1 rounded-full text-gray-600">
                          <Hash size={11} /> {quiz.join_code}
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 truncate">{quiz.title}</h3>
                    {quiz.description && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{quiz.description}</p>}
                    <div className="flex items-center gap-5 mt-3 flex-wrap">
                      <span className="flex items-center gap-1.5 text-sm text-gray-500"><BookOpen size={14} />{qCount} questions</span>
                      {quiz.time_limit && <span className="flex items-center gap-1.5 text-sm text-gray-500"><Clock size={14} />{quiz.time_limit} min</span>}
                      {quiz.due_date && <span className="flex items-center gap-1.5 text-sm text-gray-500"><Calendar size={14} />Due {new Date(quiz.due_date).toLocaleDateString()}</span>}
                      {isTeacher && <span className="flex items-center gap-1.5 text-sm text-gray-500"><Users size={14} />{subCount} submitted</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                    {isTeacher ? (
                      <>
                        {!quiz.is_published && (
                          <button onClick={() => publishQuiz(quiz)} className="flex items-center gap-1.5 text-sm text-green-600 hover:bg-green-50 px-3 py-2 rounded-lg transition-all">
                            <Eye size={15} /> Publish
                          </button>
                        )}
                        <button onClick={() => { setSelected(quiz); setView('wayground'); }} className="flex items-center gap-1.5 text-sm text-primary hover:bg-blue-50 px-3 py-2 rounded-lg transition-all">
                          <Play size={15} /> Launch
                        </button>
                        <button onClick={() => { setSelected(quiz); setView('analytics'); }} className="flex items-center gap-1.5 text-sm text-gray-600 hover:bg-gray-50 px-3 py-2 rounded-lg transition-all">
                          <BarChart2 size={15} /> Results
                        </button>
                        <button onClick={() => { setSelected(quiz); setView('makeup'); }} className="flex items-center gap-1.5 text-sm text-purple-600 hover:bg-purple-50 px-3 py-2 rounded-lg transition-all">
                          <FlaskConical size={15} /> Makeup
                        </button>
                        <button onClick={() => { setSelected(quiz); setView('editor'); }} className="flex items-center gap-1.5 text-sm text-gray-600 hover:bg-gray-50 px-3 py-2 rounded-lg transition-all">
                          <Edit3 size={15} /> Edit
                        </button>
                        <button onClick={() => deleteQuiz(quiz.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                          <Trash2 size={15} />
                        </button>
                      </>
                    ) : (
                      quiz.status === 'waiting' || quiz.status === 'active' ? (
                        <button onClick={() => { setSelected(quiz); setView('wayground'); }} className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl font-medium hover:bg-primary-dark transition-all shadow-sm">
                          <Play size={15} /> Join
                        </button>
                      ) : mySubmission ? (
                        <button onClick={() => { setSelected(quiz); setView('results'); }} className="flex items-center gap-2 text-primary border border-primary px-4 py-2 rounded-xl font-medium hover:bg-blue-50 transition-all">
                          <Eye size={15} /> View Score
                        </button>
                      ) : null
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function JoinByCode({ userId, onJoin }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('quizzes')
      .select('*')
      .eq('join_code', code.trim().toUpperCase())
      .single();

    if (err || !data) { setError('Invalid quiz code.'); setLoading(false); return; }
    if (data.status === 'ended') { setError('This quiz has already ended.'); setLoading(false); return; }
    setLoading(false);
    onJoin(data);
  }

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-center gap-3">
      <Hash size={18} className="text-primary flex-shrink-0" />
      <input
        value={code}
        onChange={e => setCode(e.target.value.toUpperCase())}
        placeholder="Enter quiz code..."
        maxLength={6}
        className="flex-1 bg-transparent text-sm font-mono tracking-widest focus:outline-none text-gray-800 placeholder-gray-400 uppercase"
        onKeyDown={e => e.key === 'Enter' && handleJoin()}
      />
      {error && <span className="text-xs text-red-500">{error}</span>}
      <button
        onClick={handleJoin}
        disabled={loading}
        className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-dark transition-all"
      >
        {loading ? '...' : 'Join'}
      </button>
    </div>
  );
}