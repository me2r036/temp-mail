export interface EmailSummary {
	id: string;
	from_address: string;
	to_address: string;
	subject: string | null;
	received_at: number;
	has_attachments: boolean;
	attachment_count: number;
}

export interface EmailDetail extends EmailSummary {
	html_content: string | null;
	text_content: string | null;
}

export interface ApiErrorBody {
	success: false;
	error?: string | {
		name?: string;
		message?: string;
	};
	note?: {
		supported_domains?: string[];
	};
}
