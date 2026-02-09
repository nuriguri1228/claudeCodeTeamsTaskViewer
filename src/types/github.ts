export interface ProjectInfo {
  id: string;
  number: number;
  url: string;
  title: string;
  owner: string;
}

export interface ProjectField {
  id: string;
  name: string;
  dataType: 'TEXT' | 'SINGLE_SELECT' | 'NUMBER' | 'DATE' | 'ITERATION';
}

export interface SingleSelectOption {
  id: string;
  name: string;
}

export interface StatusFieldInfo {
  fieldId: string;
  options: SingleSelectOption[];
}

export interface ProjectItem {
  id: string;
  content?: {
    id: string;
    title: string;
    body?: string;
  };
  fieldValues: Record<string, string>;
}

export interface CreatedIssue {
  id: string;
  number: number;
  url: string;
  title: string;
}

export interface LabelInfo {
  id: string;
  name: string;
}
