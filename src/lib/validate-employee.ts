// src/lib/validate-employee.ts
// Reusable employee foreign key validation service
// Validates employee existence and active status before creating records

import { getById } from '@/lib/db';

export interface EmployeeValidationResult {
  valid: boolean;
  error?: string;
  employee?: {
    id: string;
    name: string;
    department: string;
    position: string;
    isActive: boolean;
  };
}

/**
 * Validate that an employeeId references an existing, active employee.
 * Use this in ALL POST/PUT handlers that accept employeeId before saving.
 *
 * @param employeeId - The employee ID to validate
 * @param required - If true, rejects when employeeId is empty. If false, skips validation when empty.
 * @returns Validation result with employee data or error message
 */
export async function validateEmployeeId(
  employeeId: string | null | undefined,
  required: boolean = true
): Promise<EmployeeValidationResult> {
  // Skip validation if employeeId is optional and not provided
  if (!employeeId) {
    if (required) {
      return { valid: false, error: 'Employee ID is required' };
    }
    return { valid: true };
  }

  // Look up employee in database
  const employee = await getById<any>('employees', employeeId);

  if (!employee) {
    return {
      valid: false,
      error: `Employee not found: ${employeeId}`,
    };
  }

  // Check if employee is active (not suspended)
  if (employee.isSuspended) {
    return {
      valid: false,
      error: `Employee is suspended: ${employee.name || employeeId}`,
    };
  }

  return {
    valid: true,
    employee: {
      id: employee.id,
      name: employee.name || '',
      department: employee.department || '',
      position: employee.position || '',
      isActive: true,
    },
  };
}
