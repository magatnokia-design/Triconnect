import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, CircleX, Loader2, Trophy } from 'lucide-react'
import { supabase } from '../../config/supabase'
import { useAuthStore } from '../../store/authStore'

function isCorrect(question, rawAnswer) {
	if (rawAnswer === null || rawAnswer === undefined) return false
	const answer = `${rawAnswer}`
	const correct = `${question.correct_answer ?? ''}`
	if (question.question_type === 'trace_error') return answer === correct
	return answer.trim().toUpperCase() === correct.trim().toUpperCase()
}

function computeScore(questions, submission) {
	if (!submission) return { score: 0, total: 0, correctCount: 0 }

	const total = questions.reduce((sum, q) => sum + Number(q.points || 1), 0)
	let correctCount = 0
	const score = questions.reduce((sum, q) => {
		const ok = isCorrect(q, submission.answers?.[q.id])
		if (ok) {
			correctCount += 1
			return sum + Number(q.points || 1)
		}
		return sum
	}, 0)

	return { score, total, correctCount }
}

export default function QuizResults({ quiz, onBack }) {
	const { user } = useAuthStore()
	const [questions, setQuestions] = useState([])
	const [mySubmission, setMySubmission] = useState(null)
	const [rank, setRank] = useState(null)
	const [totalParticipants, setTotalParticipants] = useState(0)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')

	useEffect(() => {
		if (!quiz?.id || !user?.id) return

		const load = async () => {
			setLoading(true)
			setError('')

			const [{ data: qs, error: questionsError }, { data: subs, error: submissionsError }] = await Promise.all([
				supabase
					.from('quiz_questions')
					.select('*')
					.eq('quiz_id', quiz.id)
					.order('order_index', { ascending: true }),
				supabase
					.from('quiz_submissions')
					.select('id, student_id, answers, score, total_points, submitted_at')
					.eq('quiz_id', quiz.id),
			])

			if (questionsError || submissionsError) {
				setError(questionsError?.message || submissionsError?.message || 'Failed to load quiz results.')
				setLoading(false)
				return
			}

			const list = qs || []
			const submissions = subs || []
			const mine = submissions.find((item) => item.student_id === user.id) || null

			setQuestions(list)
			setMySubmission(mine)
			setTotalParticipants(submissions.length)

			if (mine) {
				const ranked = submissions
					.map((submission) => {
						const calculated = computeScore(list, submission)
						const total = calculated.total || Number(submission.total_points || 0)
						const score = calculated.total > 0 ? calculated.score : Number(submission.score || 0)
						const pct = total > 0 ? (score / total) : 0
						return {
							id: submission.student_id,
							pct,
							submittedAt: submission.submitted_at || '',
						}
					})
					.sort((a, b) => {
						if (b.pct !== a.pct) return b.pct - a.pct
						return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
					})

				setRank(ranked.findIndex((item) => item.id === user.id) + 1)
			} else {
				setRank(null)
			}

			setLoading(false)
		}

		load()
	}, [quiz?.id, user?.id])

	const summary = useMemo(() => {
		const fallbackTotal = Number(mySubmission?.total_points || 0)
		const fallbackScore = Number(mySubmission?.score || 0)
		const computed = computeScore(questions, mySubmission)
		const total = computed.total > 0 ? computed.total : fallbackTotal
		const score = computed.total > 0 ? computed.score : fallbackScore
		const pct = total > 0 ? Math.round((score / total) * 100) : 0
		return {
			score,
			total,
			pct,
			correctCount: computed.correctCount,
			questionCount: questions.length,
		}
	}, [mySubmission, questions])

	if (loading) {
		return (
			<div className="flex justify-center py-16">
				<Loader2 className="animate-spin text-primary" size={28} />
			</div>
		)
	}

	if (error) {
		return (
			<div className="max-w-xl mx-auto py-10">
				<div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
				<button onClick={onBack} className="mt-4 text-primary font-semibold hover:underline">Back</button>
			</div>
		)
	}

	if (!mySubmission) {
		return (
			<div className="text-center py-16">
				<p className="text-gray-500">You have not submitted this quiz yet.</p>
				<button onClick={onBack} className="mt-4 text-primary font-semibold hover:underline">Back</button>
			</div>
		)
	}

	return (
		<div className="space-y-6 max-w-3xl mx-auto">
			<button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition">
				<ArrowLeft size={16} /> Back to quizzes
			</button>

			<div className={`rounded-2xl p-6 md:p-8 text-white shadow-lg ${summary.pct >= 75 ? 'bg-gradient-to-r from-emerald-500 to-green-600' : summary.pct >= 50 ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-rose-500 to-red-600'}`}>
				<p className="text-sm text-white/80">{quiz?.title}</p>
				<p className="text-4xl font-black mt-1">{summary.pct}%</p>
				<p className="text-sm text-white/90 mt-1">{summary.score}/{summary.total} points</p>
				<div className="mt-4 flex flex-wrap gap-2 text-xs">
					<span className="px-2.5 py-1 rounded-md bg-white/20">Correct: {summary.correctCount}/{summary.questionCount}</span>
					{rank ? <span className="px-2.5 py-1 rounded-md bg-white/20 inline-flex items-center gap-1"><Trophy size={12} /> Rank #{rank} of {totalParticipants}</span> : null}
				</div>
			</div>

			<div className="space-y-3">
				<h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Question Feedback</h3>
				{questions.map((question, index) => {
					const answer = mySubmission.answers?.[question.id]
					const correct = isCorrect(question, answer)
					return (
						<div key={question.id} className={`rounded-xl border p-4 ${correct ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}>
							<div className="flex items-start gap-3">
								<div className={`mt-0.5 ${correct ? 'text-emerald-600' : 'text-rose-600'}`}>
									{correct ? <CheckCircle2 size={18} /> : <CircleX size={18} />}
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-xs text-gray-500 mb-1">Question {index + 1} • {question.points || 1} pt{(question.points || 1) !== 1 ? 's' : ''}</p>
									<p className="text-sm font-medium text-gray-800 mb-2">{question.question}</p>
									<p className={`text-xs rounded-md px-2 py-1 inline-block ${correct ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
										Your answer: {answer === null || answer === undefined || `${answer}`.trim() === '' ? '(no answer)' : `${answer}`}
									</p>
									{!correct && (
										<p className="text-xs rounded-md px-2 py-1 inline-block bg-emerald-100 text-emerald-700 mt-2 ml-0 md:ml-2">
											Correct answer: {question.correct_answer || 'N/A'}
										</p>
									)}
								</div>
							</div>
						</div>
					)
				})}
			</div>
		</div>
	)
}
