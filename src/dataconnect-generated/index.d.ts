import { ConnectorConfig, DataConnect, QueryRef, QueryPromise, ExecuteQueryOptions, MutationRef, MutationPromise, DataConnectSettings } from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;
export const dataConnectSettings: DataConnectSettings;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;




export interface Attendance_Key {
  id: UUIDString;
  __typename?: 'Attendance_Key';
}

export interface CreateDepartmentData {
  department_insert: Department_Key;
}

export interface CreateDepartmentVariables {
  name: string;
  managerName: string;
  officeLocation?: string | null;
}

export interface CreateEmployeeData {
  employee_insert: Employee_Key;
}

export interface CreateEmployeeVariables {
  fullName: string;
  email: string;
  position: string;
  joinDate: DateString;
}

export interface CreateOrderData {
  order_insert: Order_Key;
}

export interface CreateOrderVariables {
  title: string;
  status: string;
  priority: string;
}

export interface Department_Key {
  id: UUIDString;
  __typename?: 'Department_Key';
}

export interface Employee_Key {
  id: UUIDString;
  __typename?: 'Employee_Key';
}

export interface ListDepartmentsData {
  departments: ({
    name: string;
    managerName: string;
    officeLocation?: string | null;
  })[];
}

export interface Order_Key {
  id: UUIDString;
  __typename?: 'Order_Key';
}

export interface PerformanceRecord_Key {
  id: UUIDString;
  __typename?: 'PerformanceRecord_Key';
}

export interface TravelRequest_Key {
  id: UUIDString;
  __typename?: 'TravelRequest_Key';
}

interface CreateDepartmentRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateDepartmentVariables): MutationRef<CreateDepartmentData, CreateDepartmentVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateDepartmentVariables): MutationRef<CreateDepartmentData, CreateDepartmentVariables>;
  operationName: string;
}
export const createDepartmentRef: CreateDepartmentRef;

export function createDepartment(vars: CreateDepartmentVariables): MutationPromise<CreateDepartmentData, CreateDepartmentVariables>;
export function createDepartment(dc: DataConnect, vars: CreateDepartmentVariables): MutationPromise<CreateDepartmentData, CreateDepartmentVariables>;

interface CreateEmployeeRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateEmployeeVariables): MutationRef<CreateEmployeeData, CreateEmployeeVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateEmployeeVariables): MutationRef<CreateEmployeeData, CreateEmployeeVariables>;
  operationName: string;
}
export const createEmployeeRef: CreateEmployeeRef;

export function createEmployee(vars: CreateEmployeeVariables): MutationPromise<CreateEmployeeData, CreateEmployeeVariables>;
export function createEmployee(dc: DataConnect, vars: CreateEmployeeVariables): MutationPromise<CreateEmployeeData, CreateEmployeeVariables>;

interface CreateOrderRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateOrderVariables): MutationRef<CreateOrderData, CreateOrderVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateOrderVariables): MutationRef<CreateOrderData, CreateOrderVariables>;
  operationName: string;
}
export const createOrderRef: CreateOrderRef;

export function createOrder(vars: CreateOrderVariables): MutationPromise<CreateOrderData, CreateOrderVariables>;
export function createOrder(dc: DataConnect, vars: CreateOrderVariables): MutationPromise<CreateOrderData, CreateOrderVariables>;

interface ListDepartmentsRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListDepartmentsData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListDepartmentsData, undefined>;
  operationName: string;
}
export const listDepartmentsRef: ListDepartmentsRef;

export function listDepartments(options?: ExecuteQueryOptions): QueryPromise<ListDepartmentsData, undefined>;
export function listDepartments(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<ListDepartmentsData, undefined>;

