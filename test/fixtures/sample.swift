// Sample Swift fixture for smoke tests

import Foundation

struct PatientProfile {
    let id: UUID
    var name: String
    var dateOfBirth: Date
    var diagnosis: String?

    init(name: String, dateOfBirth: Date, diagnosis: String? = nil) {
        self.id = UUID()
        self.name = name
        self.dateOfBirth = dateOfBirth
        self.diagnosis = diagnosis
    }

    var age: Int {
        Calendar.current.dateComponents([.year], from: dateOfBirth, to: Date()).year ?? 0
    }

    func summary() -> String {
        var parts = ["Patient: \(name)", "Age: \(age)"]
        if let diag = diagnosis {
            parts.append("Diagnosis: \(diag)")
        }
        parts.joined(separator: ", ")
    }
}

class PatientManager {
    private var patients: [PatientProfile] = []

    func add(_ patient: PatientProfile) {
        patients.append(patient)
    }

    func find(id: UUID) -> PatientProfile? {
        patients.first { $0.id == id }
    }

    var count: Int {
        patients.count
    }
}
