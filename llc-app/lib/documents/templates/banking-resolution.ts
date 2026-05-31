export const bankingResolutionTemplate = `BANKING RESOLUTION OF {{NOMBRE_LLC}}

The undersigned, being the Member(s) of {{NOMBRE_LLC}}, a Texas limited liability company, hereby certifies that the following resolution was adopted on {{FECHA_HOY}}:

RESOLVED, that the Company is authorized to open and maintain one or more bank accounts with any financial institution selected by the Member(s), and to take all actions necessary to open such accounts.

FURTHER RESOLVED, that the following individual(s) are authorized to sign on behalf of the Company with respect to such bank accounts:

  Authorized Signer: {{NOMBRE_SOCIO_1}}

This resolution remains in full force and effect unless modified or rescinded in writing.

Company Information:
  LLC Name:  {{NOMBRE_LLC}}
  Type:      {{TIPO_LLC}}
  Activity:  {{ACTIVIDAD_LLC}}
  Address:   {{DIRECCION_LLC}}

Member(s) Signature:

Signature: _______________________________
Name:      {{NOMBRE_SOCIO_1}}
Title:     Owner / Member
Date:      {{FECHA_HOY}}

Case ID: {{CLIENT_ID}}`;
