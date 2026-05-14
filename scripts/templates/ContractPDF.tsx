import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles } from './styles.js';
import type { ContractFields } from '@idp/schemas';

export function ContractPDF({ data, title }: { data: ContractFields; title: string }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>{title}</Text>
        <Text style={styles.subtle}>Effective {data.effectiveDate}</Text>

        <Text style={styles.h2}>Parties</Text>
        {data.parties.map((p, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.label}>{p.role}</Text>
            <Text style={styles.value}>{p.name}</Text>
          </View>
        ))}

        <View style={styles.block}>
          <View style={styles.row}>
            <Text style={styles.label}>Term</Text>
            <Text style={styles.value}>{data.term}</Text>
          </View>
          {data.contractValue != null && (
            <View style={styles.row}>
              <Text style={styles.label}>Contract value</Text>
              <Text style={styles.value}>${data.contractValue.toLocaleString()}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>Governing law</Text>
            <Text style={styles.value}>{data.governingLaw}</Text>
          </View>
        </View>

        <Text style={styles.h2}>Key clauses</Text>
        {data.keyClauses.map((c, i) => (
          <View key={i} style={{ marginBottom: 8 }}>
            <Text style={styles.bold}>{i + 1}. {c.label}</Text>
            <Text style={{ marginTop: 2, textAlign: 'justify' }}>{c.text}</Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}
