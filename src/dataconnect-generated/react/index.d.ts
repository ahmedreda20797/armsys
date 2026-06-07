import { CreateDepartmentData, CreateDepartmentVariables, CreateEmployeeData, CreateEmployeeVariables, CreateOrderData, CreateOrderVariables, ListDepartmentsData } from '../';
import { UseDataConnectQueryResult, useDataConnectQueryOptions, UseDataConnectMutationResult, useDataConnectMutationOptions} from '@tanstack-query-firebase/react/data-connect';
import { UseQueryResult, UseMutationResult} from '@tanstack/react-query';
import { DataConnect } from 'firebase/data-connect';
import { FirebaseError } from 'firebase/app';


export function useCreateDepartment(options?: useDataConnectMutationOptions<CreateDepartmentData, FirebaseError, CreateDepartmentVariables>): UseDataConnectMutationResult<CreateDepartmentData, CreateDepartmentVariables>;
export function useCreateDepartment(dc: DataConnect, options?: useDataConnectMutationOptions<CreateDepartmentData, FirebaseError, CreateDepartmentVariables>): UseDataConnectMutationResult<CreateDepartmentData, CreateDepartmentVariables>;

export function useCreateEmployee(options?: useDataConnectMutationOptions<CreateEmployeeData, FirebaseError, CreateEmployeeVariables>): UseDataConnectMutationResult<CreateEmployeeData, CreateEmployeeVariables>;
export function useCreateEmployee(dc: DataConnect, options?: useDataConnectMutationOptions<CreateEmployeeData, FirebaseError, CreateEmployeeVariables>): UseDataConnectMutationResult<CreateEmployeeData, CreateEmployeeVariables>;

export function useCreateOrder(options?: useDataConnectMutationOptions<CreateOrderData, FirebaseError, CreateOrderVariables>): UseDataConnectMutationResult<CreateOrderData, CreateOrderVariables>;
export function useCreateOrder(dc: DataConnect, options?: useDataConnectMutationOptions<CreateOrderData, FirebaseError, CreateOrderVariables>): UseDataConnectMutationResult<CreateOrderData, CreateOrderVariables>;

export function useListDepartments(options?: useDataConnectQueryOptions<ListDepartmentsData>): UseDataConnectQueryResult<ListDepartmentsData, undefined>;
export function useListDepartments(dc: DataConnect, options?: useDataConnectQueryOptions<ListDepartmentsData>): UseDataConnectQueryResult<ListDepartmentsData, undefined>;
