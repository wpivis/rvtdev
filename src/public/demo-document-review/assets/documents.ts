/**
 * Fabricated contracts for the document-review demo.
 *
 * Nothing here is real legal text and none of it is legal advice: the parties,
 * the drafting and the planted problems are all invented for a demo study. The
 * clauses are written long enough that reviewing one means scrolling, which is
 * the point -- scroll position is one of the behaviours the task records.
 *
 * `DEMO_BRANCH.md` lists which clauses carry a planted problem. That list is
 * deliberately kept out of this module so it cannot reach the participant's DOM.
 */

export interface Clause {
  /** Section number as printed in the document, e.g. "4.2". */
  number: string;
  heading: string;
  text: string;
}

export interface LegalDocument {
  id: string;
  /** Document title, shown as the pane header. */
  title: string;
  /** One line naming the parties and the effective date. */
  parties: string;
  /** What the reviewing attorney has been asked to do, shown above the document. */
  brief: string;
  clauses: Clause[];
}

const MUTUAL_NDA: LegalDocument = {
  id: 'mutual-nda',
  title: 'Mutual Non-Disclosure Agreement',
  parties: 'Northvale Analytics, Inc. and Caldwell Instruments, LLC — effective March 4, 2026',
  brief: 'Northvale is considering a joint development project with Caldwell. Caldwell sent this NDA on its own paper and has asked Northvale to sign it as-is.',
  clauses: [
    {
      number: '1',
      heading: 'Definition of Confidential Information',
      text: 'For purposes of this Agreement, "Confidential Information" means any and all information disclosed by either party to the other, whether before or after the Effective Date, in any form whatsoever, whether or not marked, designated, or otherwise identified as confidential at the time of disclosure. Confidential Information includes, without limitation, technical data, trade secrets, know-how, research, product plans, customer lists, pricing, financial information, forecasts, and the existence and contents of this Agreement itself. Each party acknowledges that information need not be reduced to writing to constitute Confidential Information, and that the absence of a confidentiality legend shall not be construed as a waiver of confidential treatment.',
    },
    {
      number: '2',
      heading: 'Exclusions',
      text: 'Confidential Information does not include information that the receiving party can demonstrate by contemporaneous written records: (a) was rightfully in its possession without restriction prior to disclosure by the disclosing party; (b) is or becomes generally available to the public through no act or omission of the receiving party; or (c) was rightfully received from a third party without restriction and without breach of any obligation owed to the disclosing party. The receiving party bears the burden of establishing any exclusion under this Section by clear and convincing evidence.',
    },
    {
      number: '3',
      heading: 'Permitted Use',
      text: 'The receiving party shall use the Confidential Information solely for the purpose of evaluating and pursuing a potential business relationship between the parties (the "Purpose") and for no other purpose whatsoever. The receiving party shall not use the Confidential Information for its own benefit or for the benefit of any third party, nor shall it reverse engineer, disassemble, or decompile any prototypes, software, or other tangible objects that embody Confidential Information.',
    },
    {
      number: '4',
      heading: 'Standard of Care',
      text: 'The receiving party shall protect the Confidential Information using not less than the same degree of care it uses to protect its own confidential information of a similar nature, and in no event less than a reasonable degree of care. The receiving party may disclose Confidential Information only to those of its employees, officers, directors, and professional advisors who have a bona fide need to know such information for the Purpose and who are bound by written obligations of confidentiality no less protective than those contained herein.',
    },
    {
      number: '5',
      heading: 'Term and Survival',
      text: 'This Agreement shall commence on the Effective Date and shall continue in effect until terminated by either party upon thirty (30) days written notice to the other. Notwithstanding any termination or expiration of this Agreement, the obligations of confidentiality and non-use set forth herein shall survive in perpetuity with respect to all Confidential Information disclosed hereunder, and shall bind the receiving party, its successors, and its assigns without limitation as to time.',
    },
    {
      number: '6',
      heading: 'Compelled Disclosure',
      text: 'If the receiving party is required by law, regulation, or valid order of a court or governmental authority to disclose any Confidential Information, it may do so solely to the extent so required, provided that it gives the disclosing party prompt written notice, to the extent legally permitted, so that the disclosing party may seek a protective order or other appropriate remedy. The receiving party shall reasonably cooperate with the disclosing party, at the disclosing party’s expense, in any such effort.',
    },
    {
      number: '7',
      heading: 'Return or Destruction of Materials',
      text: 'Upon the disclosing party’s written request, the receiving party shall promptly return or destroy all materials embodying Confidential Information. Notwithstanding the foregoing, the receiving party shall be entitled to retain copies of Confidential Information contained in its archival, backup, disaster recovery, or electronic message retention systems for so long as such systems are maintained, and shall be under no obligation to certify the return or destruction of any materials.',
    },
    {
      number: '8',
      heading: 'Residual Knowledge',
      text: 'Notwithstanding anything to the contrary in this Agreement, either party shall be free to use for any purpose the Residuals resulting from access to or work with the Confidential Information of the other party. "Residuals" means information in intangible form that is retained in the unaided memory of persons who have had access to Confidential Information, including ideas, concepts, know-how, and techniques. Neither party shall have any obligation to limit or restrict the assignment of such persons or to pay royalties for any work resulting from the use of Residuals.',
    },
    {
      number: '9',
      heading: 'No License; No Warranty',
      text: 'Nothing in this Agreement grants the receiving party any license or right under any patent, copyright, trademark, or other intellectual property right of the disclosing party, whether by implication, estoppel, or otherwise. All Confidential Information is provided "AS IS," and the disclosing party makes no representation or warranty as to its accuracy, completeness, or fitness for any particular purpose.',
    },
    {
      number: '10',
      heading: 'Remedies',
      text: 'The receiving party acknowledges that any breach of this Agreement would cause irreparable harm for which monetary damages would be an inadequate remedy. Accordingly, Caldwell Instruments, LLC shall be entitled to seek injunctive relief, specific performance, and any other equitable remedy without the necessity of posting a bond or proving actual damages. The prevailing party in any action arising under this Agreement shall be entitled to recover its reasonable attorneys’ fees and costs.',
    },
    {
      number: '11',
      heading: 'Assignment',
      text: 'Caldwell Instruments, LLC may assign, transfer, or delegate this Agreement or any of its rights or obligations hereunder, in whole or in part, to any affiliate or to any successor in interest, without the consent of Northvale Analytics, Inc. Northvale Analytics, Inc. may not assign, transfer, or delegate this Agreement or any right or obligation hereunder without the prior written consent of Caldwell Instruments, LLC, which consent may be withheld in its sole and absolute discretion. Any purported assignment in violation of this Section shall be void.',
    },
    {
      number: '12',
      heading: 'Governing Law; Dispute Resolution',
      text: 'This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict of laws principles. Any dispute arising out of or relating to this Agreement shall be finally resolved by binding arbitration administered in Wilmington, Delaware, before a single arbitrator. Each party waives any right to a trial by jury and any right to participate in a class, collective, or representative proceeding.',
    },
  ],
};

const SAAS_MSA: LegalDocument = {
  id: 'saas-msa',
  title: 'Master Services Agreement (Cloud Analytics Platform)',
  parties: 'Larkspur Cloud Systems, Inc. ("Provider") and Northvale Analytics, Inc. ("Customer") — effective June 1, 2026',
  brief: 'Northvale wants to move its internal reporting onto Larkspur’s platform. This is Larkspur’s standard form. Northvale’s data includes customer records covered by its own privacy commitments.',
  clauses: [
    {
      number: '1',
      heading: 'Services and Order Forms',
      text: 'Provider shall make the subscription services described in one or more mutually executed Order Forms (the "Services") available to Customer during the applicable subscription term. Each Order Form is governed by and incorporated into this Agreement. In the event of a conflict between an Order Form and this Agreement, the terms of this Agreement shall control except where the Order Form expressly states that it supersedes a specific numbered Section.',
    },
    {
      number: '2',
      heading: 'Fees and Payment',
      text: 'Customer shall pay all fees set forth in the applicable Order Form within thirty (30) days of invoice date. All fees are non-refundable and non-cancellable except as expressly provided herein. Provider may increase fees for any renewal term upon thirty (30) days written notice prior to the commencement of such renewal term, in an amount determined by Provider in its sole discretion. Overdue amounts accrue interest at the lesser of one and one-half percent (1.5%) per month or the maximum rate permitted by law.',
    },
    {
      number: '3',
      heading: 'Term and Automatic Renewal',
      text: 'The initial subscription term shall be as set forth in the applicable Order Form. Thereafter, the subscription shall automatically renew for successive twenty-four (24) month renewal terms unless either party provides written notice of non-renewal not less than ninety (90) days prior to the end of the then-current term. Notice of non-renewal delivered outside this window shall be of no effect, and the subscription shall renew for the full successive term.',
    },
    {
      number: '4',
      heading: 'Service Levels and Support',
      text: 'Provider shall use commercially reasonable efforts to make the Services available 99.5% of the time each calendar month, excluding scheduled maintenance, emergency maintenance, and any unavailability caused by factors outside Provider’s reasonable control. Customer’s sole and exclusive remedy for any failure to meet this commitment shall be service credits, which shall not exceed five percent (5%) of the fees paid for the affected month, and which must be requested in writing within fifteen (15) days of the incident.',
    },
    {
      number: '5',
      heading: 'Customer Data; License Grant',
      text: 'Customer retains all right, title, and interest in and to data it submits to the Services ("Customer Data"). Customer grants Provider a worldwide, non-exclusive, royalty-free, perpetual, irrevocable license to host, copy, process, transmit, display, and create derivative works of Customer Data for the purpose of providing the Services and for the purpose of developing, training, and improving Provider’s products, services, and machine learning models. This license survives termination of this Agreement.',
    },
    {
      number: '6',
      heading: 'Security',
      text: 'Provider shall maintain an information security program consistent with generally accepted industry standards, including administrative, physical, and technical safeguards designed to protect Customer Data against unauthorized access, disclosure, alteration, or destruction. Provider shall notify Customer of any confirmed breach of security resulting in the unauthorized disclosure of Customer Data without undue delay after Provider’s determination that such a breach has occurred.',
    },
    {
      number: '7',
      heading: 'Confidentiality',
      text: 'Each party shall protect the other party’s Confidential Information with the same degree of care it uses for its own confidential information of like kind, and in no event less than reasonable care. Confidential Information does not include information that is or becomes publicly available through no fault of the receiving party, was known to the receiving party without restriction prior to disclosure, or is independently developed by the receiving party without reference to the disclosing party’s Confidential Information.',
    },
    {
      number: '8',
      heading: 'Intellectual Property; Derived Data',
      text: 'Provider retains all right, title, and interest in and to the Services and all related software, documentation, and technology. As between the parties, Provider shall own all right, title, and interest in and to any aggregated, anonymized, statistical, or derived data generated from Customer Data through Provider’s operation of the Services ("Derived Data"), and may use, disclose, license, and commercialize Derived Data for any purpose without restriction or obligation of accounting to Customer.',
    },
    {
      number: '9',
      heading: 'Warranties and Disclaimer',
      text: 'Provider warrants that the Services will perform materially in accordance with the applicable documentation. EXCEPT AS EXPRESSLY SET FORTH IN THIS SECTION, THE SERVICES ARE PROVIDED "AS IS" AND PROVIDER DISCLAIMS ALL OTHER WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.',
    },
    {
      number: '10',
      heading: 'Limitation of Liability',
      text: 'PROVIDER’S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THIS AGREEMENT SHALL NOT EXCEED THE FEES PAID BY CUSTOMER IN THE THREE (3) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM. The foregoing limitation shall not apply to Customer’s payment obligations, Customer’s indemnification obligations under Section 11, or Customer’s breach of Section 7, for which Customer’s liability shall be unlimited. NEITHER PARTY SHALL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, OR PUNITIVE DAMAGES.',
    },
    {
      number: '11',
      heading: 'Indemnification',
      text: 'Customer shall defend, indemnify, and hold harmless Provider and its affiliates, officers, directors, employees, and agents from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys’ fees) arising out of or relating to Customer Data, Customer’s use of the Services, or any breach or alleged breach of this Agreement by Customer. Provider shall have the right to control the defense and settlement of any such claim with counsel of its own choosing.',
    },
    {
      number: '12',
      heading: 'Suspension and Termination',
      text: 'Provider may suspend Customer’s access to the Services immediately and without notice if Provider determines, in its sole discretion, that Customer has breached any provision of this Agreement or that such suspension is necessary to protect the Services or other customers. Either party may terminate this Agreement for material breach if the breaching party fails to cure such breach within thirty (30) days of written notice, provided that no cure period shall apply to Customer’s failure to pay fees when due.',
    },
    {
      number: '13',
      heading: 'Governing Law and Venue',
      text: 'This Agreement shall be governed by the laws of the State of Washington, without regard to its conflict of laws principles. The parties irrevocably consent to the exclusive jurisdiction and venue of the state and federal courts located in King County, Washington for any action arising out of or relating to this Agreement, and waive any objection based on forum non conveniens.',
    },
    {
      number: '14',
      heading: 'Entire Agreement; Amendment',
      text: 'This Agreement, together with all Order Forms, constitutes the entire agreement between the parties and supersedes all prior or contemporaneous understandings. Provider may modify the terms of this Agreement from time to time by posting an updated version to its website, and Customer’s continued use of the Services following such posting shall constitute acceptance of the modified terms. No modification proposed by Customer shall be effective unless signed by an authorized officer of Provider.',
    },
  ],
};

export const DOCUMENTS: Record<string, LegalDocument> = {
  [MUTUAL_NDA.id]: MUTUAL_NDA,
  [SAAS_MSA.id]: SAAS_MSA,
};

export function getDocument(id: string | undefined): LegalDocument | null {
  if (!id) {
    return null;
  }
  return DOCUMENTS[id] ?? null;
}
