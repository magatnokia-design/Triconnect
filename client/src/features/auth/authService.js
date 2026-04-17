const PSU_DOMAIN = '@pampangastateu.edu.ph'

const STUDENT_EMAIL_REGEX = /^\d+@pampangastateu\.edu\.ph$/
const TEACHER_EMAIL_REGEX = /^[a-zA-Z]+@pampangastateu\.edu\.ph$/

export function normalizeEmail(email = '') {
	return email.trim().toLowerCase()
}

export function normalizeStudentId(studentId = '') {
	return studentId.trim()
}

export function getRoleEmailHint(role) {
	if (role === 'student') {
		return 'Use your student number as email username (example: 1234567890@pampangastateu.edu.ph).'
	}

	return 'Teacher email username must contain letters only (example: juandm@pampangastateu.edu.ph).'
}

export function validateRoleBasedAccess({ email, role, studentId }) {
	const normalizedEmail = normalizeEmail(email)
	const normalizedStudentId = normalizeStudentId(studentId)

	if (!normalizedEmail) {
		return { ok: false, error: 'Email is required.' }
	}

	if (!normalizedEmail.endsWith(PSU_DOMAIN)) {
		return { ok: false, error: 'Only PSU email addresses (@pampangastateu.edu.ph) are allowed.' }
	}

	if (role === 'student') {
		if (!STUDENT_EMAIL_REGEX.test(normalizedEmail)) {
			return {
				ok: false,
				error: 'Student email must start with numbers only (example: 1234567890@pampangastateu.edu.ph).'
			}
		}

		if (!normalizedStudentId) {
			return { ok: false, error: 'Student ID is required for students.' }
		}

		if (!/^\d+$/.test(normalizedStudentId)) {
			return { ok: false, error: 'Student ID must contain numbers only.' }
		}

		const emailLocalPart = normalizedEmail.split('@')[0]
		if (emailLocalPart !== normalizedStudentId) {
			return { ok: false, error: 'Student ID must match the numbers in your PSU email.' }
		}
	}

	if (role === 'teacher' && !TEACHER_EMAIL_REGEX.test(normalizedEmail)) {
		return {
			ok: false,
			error: 'Teacher email must start with letters only (example: juandm@pampangastateu.edu.ph).'
		}
	}

	return {
		ok: true,
		normalizedEmail,
		normalizedStudentId
	}
}

