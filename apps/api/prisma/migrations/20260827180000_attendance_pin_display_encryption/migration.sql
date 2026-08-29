-- The PIN remains bcrypt-hashed for attendance verification. This separate
-- ciphertext is only for the owner/company-manager employee-file display.
ALTER TABLE "AttendanceEmployeeCredential" ADD COLUMN "pinCiphertext" TEXT;
