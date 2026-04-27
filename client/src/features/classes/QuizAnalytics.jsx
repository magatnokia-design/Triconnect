import { useState, useEffect } from 'react';
import { supabase } from '../../config/supabase';
import { useAuthStore } from '../../store/authStore';
import { Trophy, BarChart2, Download, ArrowLeft, Check, X, Users } from 'lucide-react';

function gradeAnswer(q, ans) {
  if (ans === null || ans === undefined) return false;
  const answer = `${ans}`;
  const correct = `${q.correct_answer ?? ''}`;
  if (q.question_type === 'trace_error') return answer === correct;
  return answer.trim().toUpperCase() === correct.trim().toUpperCase();
}

function evaluateSubmission(questions, submission) {
  if (!questions.length) {
    const total = submission.total_points || 0;
    const score = submission.score || 0;
    const percentage = total ? Math.round((score / total) * 100) : 0;
    return { ...submission, score, total_points: total, percentage };
  }

  const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
  const score = questions.reduce((sum, q) => {
    if (!gradeAnswer(q, submission.answers?.[q.id])) return sum;
    return sum + (q.points || 1);
  }, 0);
  const percentage = totalPoints ? Math.round((score / totalPoints) * 100) : 0;

  return {
    ...submission,
    score,
    total_points: totalPoints,
    percentage,
  };
}

function formatPoints(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';
  if (Number.isInteger(numeric)) return `${numeric}`;
  return numeric.toFixed(2).replace(/\.00$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

export default function QuizAnalytics({ quiz, onBack }) {
  const { profile } = useAuthStore();
  const isTeacher = profile?.role === 'teacher';

  const [submissions, setSubmissions] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mySubmission, setMySubmission] = useState(null);
  const { user } = useAuthStore();

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel(`quiz-analytics-${quiz.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_questions', filter: `quiz_id=eq.${quiz.id}` }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_submissions', filter: `quiz_id=eq.${quiz.id}` }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [quiz.id]);

  async function fetchData() {
    setLoading(true);
    const [{ data: subs }, { data: qs }, { data: roster }] = await Promise.all([
      supabase.from('quiz_submissions').select('*, answers, profiles(full_name, student_id)').eq('quiz_id', quiz.id),
      supabase.from('quiz_questions').select('*').eq('quiz_id', quiz.id).order('order_index'),
      supabase.from('class_enrollments').select('student_id, profiles(full_name, student_id)').eq('class_id', quiz.class_id),
    ]);

    const questionsData = qs || [];
    const rosterMap = new Map((roster || []).map(r => [r.student_id, r.profiles || null]));
    const studentIds = [...new Set((subs || []).map(s => s.student_id).filter(Boolean))];

    let directProfileMap = new Map();
    if (studentIds.length) {
      const { data: directProfiles } = await supabase
        .from('profiles')
        .select('id, full_name, student_id')
        .in('id', studentIds);
      directProfileMap = new Map((directProfiles || []).map(p => [p.id, p]));
    }

    const evaluated = (subs || [])
      .map((submission) => {
        const rosterProfile = rosterMap.get(submission.student_id);
        const directProfile = directProfileMap.get(submission.student_id);
        const mergedProfile = submission.profiles || rosterProfile || directProfile || null;
        return {
          ...evaluateSubmission(questionsData, submission),
          profiles: mergedProfile,
          student_name: mergedProfile?.full_name || submission.student_id || 'Unknown',
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return new Date(a.submitted_at || 0).getTime() - new Date(b.submitted_at || 0).getTime();
      });

    setSubmissions(evaluated);
    setQuestions(questionsData);
    if (!isTeacher) setMySubmission(evaluated.find(s => s.student_id === user.id) || null);
    setLoading(false);
  }

  function exportCSV() {
    const evaluatedForExport = submissions
      .map((submission) => {
        const evaluated = evaluateSubmission(questions, submission);
        const scorePoints = Number(evaluated.score || 0);
        const studentName = submission.student_name || submission.profiles?.full_name || 'Unknown';
        const studentCode = submission.profiles?.student_id || '';

        return {
          studentName,
          studentCode,
          score: formatPoints(scorePoints),
        };
      })
      .sort((a, b) => {
        const byName = a.studentName.localeCompare(b.studentName);
        if (byName !== 0) return byName;
        return a.studentCode.localeCompare(b.studentCode);
      });

    const escapeCSV = (value) => {
      const stringValue = String(value ?? '');
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    const rows = [
      ['Student Name', 'Student ID', 'Score'],
      ...evaluatedForExport.map((row) => [
        escapeCSV(row.studentName),
        escapeCSV(row.studentCode),
        escapeCSV(row.score),
      ])
    ];
    const csv = `\ufeff${rows.map((r) => r.join(',')).join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${quiz.title.replace(/\s+/g, '_')}_results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function buildQuestionAnalysis() {
    const ranked = [...submissions].sort((a, b) => b.score - a.score);
    const groupSize = Math.max(1, Math.floor(ranked.length / 2));
    const upperGroup = ranked.slice(0, groupSize);
    const lowerGroup = ranked.slice(-groupSize);

    return questions.map((q, idx) => {
      const attemptedCount = submissions.filter(s => {
        const ans = s.answers?.[q.id];
        return ans !== null && ans !== undefined && `${ans}`.trim() !== '';
      }).length;
      const correctCount = submissions.filter(s => gradeAnswer(q, s.answers?.[q.id])).length;
      const difficulty = attemptedCount ? (correctCount / attemptedCount) : 0;

      const upperCorrect = upperGroup.filter(s => gradeAnswer(q, s.answers?.[q.id])).length;
      const lowerCorrect = lowerGroup.filter(s => gradeAnswer(q, s.answers?.[q.id])).length;
      const upperRate = groupSize ? (upperCorrect / groupSize) : 0;
      const lowerRate = groupSize ? (lowerCorrect / groupSize) : 0;
      const discrimination = upperRate - lowerRate;

      return {
        questionNo: idx + 1,
        type: q.question_type,
        points: q.points || 1,
        attemptedCount,
        correctCount,
        difficultyPct: Math.round(difficulty * 100),
        discrimination,
      };
    });
  }

  function exportItemAnalysisCSV() {
    const analysis = buildQuestionAnalysis();
    const rows = [
      ['Question', 'Type', 'Points', 'Correct', 'Attempted', 'Difficulty %', 'Discrimination'],
      ...analysis.map((a) => [
        a.questionNo,
        a.type,
        a.points,
        a.correctCount,
        a.attemptedCount,
        `${a.difficultyPct}%`,
        a.discrimination.toFixed(2),
      ]),
    ];

    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${quiz.title.replace(/\s+/g, '_')}_item_analysis.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPoints = questions.reduce((s, q) => s + (q.points || 1), 0);
  const avg = submissions.length ? Math.round(submissions.reduce((s, sub) => s + sub.score, 0) / submissions.length) : 0;
  const highest = submissions[0];
  const lowest = submissions[submissions.length - 1];

  if (loading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  // STUDENT VIEW
  if (!isTeacher) {
    if (!mySubmission) return (
      <div className="text-center py-16">
        <p className="text-gray-500">You have not taken this quiz yet.</p>
        <button onClick={onBack} className="mt-4 text-primary hover:underline font-medium">Back</button>
      </div>
    );

    const myRank = submissions.findIndex(s => s.student_id === user.id) + 1;
    const pct = mySubmission.percentage ?? 0;

    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft size={18} /> Back
        </button>
        <div className={`rounded-2xl p-8 text-center text-white shadow-xl ${pct >= 75 ? 'bg-gradient-to-br from-green-500 to-green-600' : pct >= 50 ? 'bg-gradient-to-br from-yellow-500 to-orange-500' : 'bg-gradient-to-br from-red-500 to-red-600'}`}>
          <p className="text-sm opacity-80 mb-1">{quiz.title}</p>
          <p className="text-6xl font-black">{pct}%</p>
          <p className="opacity-90 mt-1">{mySubmission.score}/{mySubmission.total_points} pts · Rank #{myRank} of {submissions.length}</p>
        </div>

        <div className="space-y-3">
          <h3 className="font-bold text-gray-900">Question Breakdown</h3>
          {questions.map((q, idx) => {
            const ans = mySubmission.answers?.[q.id];
            const correct = gradeAnswer(q, ans);
            return (
              <div key={q.id} className={`bg-white rounded-2xl border-2 p-5 ${correct ? 'border-green-200' : 'border-red-200'}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${correct ? 'bg-green-500' : 'bg-red-400'}`}>
                    {correct ? <Check size={14} className="text-white" /> : <X size={14} className="text-white" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-1">Question {idx + 1} · {q.points} pt{q.points !== 1 ? 's' : ''}</p>
                    {q.code_snippet && <pre className="bg-gray-900 text-green-400 rounded-lg p-3 text-xs font-mono mb-2 overflow-x-auto">{q.code_snippet}</pre>}
                    <p className="font-medium text-gray-900 mb-3">{q.question}</p>
                    <div className="space-y-1.5">
                      <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${correct ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        <span className="font-medium">Your answer:</span>
                        <span className="font-mono">{ans || '(no answer)'}</span>
                      </div>
                      {!correct && (
                        <div className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-green-50 text-green-700">
                          <span className="font-medium">Correct answer:</span>
                          <span className="font-mono">{q.correct_answer}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // TEACHER VIEW
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-all"><ArrowLeft size={20} /></button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">{quiz.title} — Analytics</h2>
            <p className="text-sm text-gray-500">{submissions.length} submission{submissions.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        {submissions.length > 0 && (
          <div className="flex items-center gap-2">
            <button onClick={exportCSV} className="flex items-center gap-2 border border-gray-200 text-gray-700 px-4 py-2 rounded-xl hover:bg-gray-50 transition-all text-sm font-medium">
              <Download size={16} /> Export Scores CSV
            </button>
            <button onClick={exportItemAnalysisCSV} className="flex items-center gap-2 border border-gray-200 text-gray-700 px-4 py-2 rounded-xl hover:bg-gray-50 transition-all text-sm font-medium">
              <BarChart2 size={16} /> Export Item Analysis
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Submissions', value: submissions.length, color: 'text-primary' },
          { label: 'Average Score', value: `${avg}/${totalPoints}`, color: 'text-blue-600' },
          { label: 'Highest', value: highest ? `${highest.score}/${totalPoints}` : '—', color: 'text-green-600' },
          { label: 'Lowest', value: lowest ? `${lowest.score}/${totalPoints}` : '—', color: 'text-red-500' },
        ].map(stat => (
          <div key={stat.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Per-Question Stats */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2"><BarChart2 size={18} className="text-primary" /> Per-Question Analysis</h3>
        {questions.map((q, idx) => {
          const correct = submissions.filter(s => gradeAnswer(q, s.answers?.[q.id])).length;
          const pct = submissions.length ? Math.round((correct / submissions.length) * 100) : 0;
          return (
            <div key={q.id} className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-xs text-gray-400 mb-0.5">Q{idx + 1} · {q.question_type?.replace('_', ' ')} · {q.points} pt{q.points !== 1 ? 's' : ''}</p>
                  {q.code_snippet && <pre className="bg-gray-900 text-green-400 rounded-lg p-2 text-xs font-mono mb-1 overflow-x-auto">{q.code_snippet}</pre>}
                  <p className="text-sm font-medium text-gray-800 line-clamp-2">{q.question}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-gray-900">{correct}/{submissions.length}</p>
                  <p className={`text-xs font-medium ${pct >= 75 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>{pct}% correct</p>
                </div>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${pct >= 75 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Rankings Table */}
      {submissions.length === 0 ? (
        <div className="text-center py-16 bg-surface rounded-2xl border-2 border-dashed border-blue-200">
          <Users size={40} className="mx-auto text-blue-300 mb-3" />
          <p className="text-gray-500">No submissions yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <Trophy size={18} className="text-yellow-500" />
            <h3 className="font-bold text-gray-900">Rankings</h3>
          </div>
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Rank', 'Student', 'Score', '%'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {submissions.map((sub, idx) => {
                const pct = sub.percentage ?? 0;
                return (
                  <tr key={sub.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${idx === 0 ? 'bg-yellow-400' : idx === 1 ? 'bg-gray-400' : idx === 2 ? 'bg-orange-400' : 'bg-blue-200 text-blue-700'}`}>{idx + 1}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold">{sub.student_name?.[0]?.toUpperCase() || sub.profiles?.full_name?.[0]?.toUpperCase() || '?'}</div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{sub.student_name || sub.profiles?.full_name || 'Unknown'}</p>
                          {sub.profiles?.student_id && <p className="text-xs text-gray-400">{sub.profiles.student_id}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4"><span className="font-semibold">{sub.score}</span><span className="text-gray-400">/{sub.total_points}</span></td>
                    <td className="px-6 py-4">
                      <span className={`text-sm font-semibold ${pct >= 75 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>{pct}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}